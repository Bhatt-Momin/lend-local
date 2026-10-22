const Notification = require('../models/Notification');
const User = require('../models/User');

let getMessaging = null;
try {
  const adminMessaging = require('firebase-admin/messaging');
  getMessaging = adminMessaging.getMessaging;
} catch (err) {
  console.warn('Firebase Admin messaging module unavailable; push delivery will be disabled:', err?.message);
}

/**
 * Safely prunes an invalid FCM token reported by Firebase.
 * Uses registration-specific identity/version (userId and claim) captured when the
 * send began. Removes ONLY the registration matching that specific identity/version.
 * A late error from a previous send will NOT delete a token that has been transferred
 * to another user or re-registered with a new claim.
 */
async function pruneInvalidFcmToken(target) {
  if (!target) return;

  let token = null;
  let userId = null;
  let claim = null;
  let isLegacyScalarOnly = false;

  if (typeof target === 'string') {
    token = target.trim();
  } else if (typeof target === 'object' && target !== null) {
    token = target.token?.trim();
    userId = target.userId || null;
    claim = target.claim || null;
    isLegacyScalarOnly = Boolean(target.isLegacyScalarOnly);
  }

  if (!token) return;

  // P1: If target lacks a scoped userId (e.g. legacy unscoped caller),
  // do NOT perform an unscoped destructive delete across unrelated users.
  if (!userId) {
    console.warn(
      'Skipping unscoped FCM token pruning: registration target userId is missing for token:',
      token
    );
    return;
  }

  try {
    // 1. Remove matching token from fcmTokens array for this specific user:
    // If claim is known, match that exact version to prevent deleting a re-registered token.
    // If isLegacyScalarOnly, do not delete any newer array entries that possess a valid claim.
    const pullFilter = { token: token };
    if (claim) {
      pullFilter.claim = claim;
    } else if (isLegacyScalarOnly) {
      pullFilter.$or = [{ claim: null }, { claim: { $exists: false } }];
    }

    await User.updateOne(
      { _id: userId, 'fcmTokens.token': token },
      { $pull: { fcmTokens: pullFilter } }
    );

    // 2. Clear scalar fcmToken on this user ONLY if it matches this exact token
    // If claim is known, match that exact claim version
    const scalarFilter = { _id: userId, fcmToken: token };
    if (claim) {
      scalarFilter.fcmClaim = claim;
    }

    const result = await User.updateOne(
      scalarFilter,
      { $set: { fcmToken: null, fcmSessionId: null, fcmClaim: null } }
    );

    // 3. For the user whose scalar was cleared, promote an active remaining device if available
    if (result.modifiedCount > 0) {
      const affectedUser = await User.findOne({
        _id: userId,
        fcmToken: null,
        'fcmTokens.0': { $exists: true },
      }).select('_id fcmTokens');

      if (affectedUser && Array.isArray(affectedUser.fcmTokens) && affectedUser.fcmTokens.length > 0) {
        const webToken = affectedUser.fcmTokens.find((t) => t.platform === 'web');
        const fallback = webToken || affectedUser.fcmTokens[affectedUser.fcmTokens.length - 1];
        await User.updateOne(
          { _id: userId, fcmToken: null },
          { $set: { fcmToken: fallback.token, fcmSessionId: fallback.sessionId, fcmClaim: fallback.claim } }
        );
      }
    }
  } catch (err) {
    console.error('Error pruning invalid FCM token (non-fatal):', err?.message || err);
  }
}

/**
 * Send an FCM push notification to a single device token or target metadata object.
 * Non-blocking, never throws.
 */
async function dispatchFcmPush(targetOrToken, title, bodyStr, data = {}) {
  let token;
  let targetObj = null;

  if (typeof targetOrToken === 'string') {
    token = targetOrToken.trim();
    // P1: Resolve current registration identity before dispatch so cleanup is scoped and safe
    try {
      const matchedUser = await User.findOne({
        $or: [
          { 'fcmTokens.token': token },
          { fcmToken: token },
        ],
      }).select('_id fcmTokens fcmToken fcmClaim');

      if (matchedUser) {
        const entry = Array.isArray(matchedUser.fcmTokens)
          ? matchedUser.fcmTokens.find((t) => t.token === token)
          : null;
        targetObj = {
          userId: matchedUser._id,
          token: token,
          claim: entry?.claim || null,
          isLegacyScalarOnly: !entry,
        };
      }
    } catch (e) {
      // Resolution error is non-fatal
    }
    if (!targetObj) {
      targetObj = { token };
    }
  } else if (targetOrToken && typeof targetOrToken === 'object') {
    token = targetOrToken.token?.trim();
    targetObj = targetOrToken;
  }

  if (!getMessaging || !token) return false;

  const messaging = typeof getMessaging === 'function' ? getMessaging() : null;
  if (!messaging || typeof messaging.send !== 'function') return false;

  try {
    const stringifiedData = Object.fromEntries(
      Object.entries(data || {}).map(([k, v]) => [k, String(v ?? '')])
    );

    const message = {
      token,
      notification: {
        title,
        body: bodyStr,
      },
      webpush: {
        notification: {
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
        },
        fcmOptions: {
          link: data?.groupId ? `/group.html?id=${data.groupId}` : '/dashboard.html',
        },
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'default',
          sound: 'default',
        },
      },
      data: stringifiedData,
    };

    await messaging.send(message);
    return true;
  } catch (err) {
    console.error('FCM push dispatch error (non-fatal):', err?.code || err?.message || err);
    // If token is invalid or unregistered, clean it up asynchronously using registration identity
    if (
      err?.code === 'messaging/invalid-registration-token' ||
      err?.code === 'messaging/registration-token-not-registered' ||
      err?.message?.includes('NotRegistered')
    ) {
      pruneInvalidFcmToken(targetObj || token).catch(() => {});
    }
    return false;
  }
}

/**
 * Creates an in-app notification and optionally dispatches FCM push.
 * Guaranteed not to fail the caller's main database transaction/operation.
 */
async function createNotification({
  recipient,
  sender = null,
  type,
  title,
  body,
  data = {},
  dedupeKey = null,
  sendPush = true,
}) {
  try {
    if (!recipient || !type || !title || !body) {
      console.warn('createNotification called with missing required fields');
      return null;
    }

    // Deduplication check
    if (dedupeKey) {
      const existing = await Notification.findOne({ recipient, dedupeKey });
      if (existing) {
        return { notification: existing, created: false, pushSent: false };
      }
    }

    let notification;
    try {
      notification = await Notification.create({
        recipient,
        sender,
        type,
        title,
        body,
        data,
        dedupeKey,
      });
    } catch (createErr) {
      // Handle MongoDB E11000 duplicate key error as idempotent success under concurrent race
      if (createErr && (createErr.code === 11000 || createErr.message?.includes('E11000'))) {
        console.log(`Duplicate notification race caught for recipient ${recipient} and dedupeKey ${dedupeKey}; treating as idempotent.`);
        const existing = await Notification.findOne({ recipient, dedupeKey });
        return { notification: existing, created: false, pushSent: false };
      }
      throw createErr;
    }

    let pushSent = false;
    if (sendPush) {
      try {
        const user = await User.findById(recipient).select('_id fcmToken fcmTokens fcmClaim');
        const activeTargets = [];
        const seenTokens = new Set();

        if (Array.isArray(user?.fcmTokens) && user.fcmTokens.length > 0) {
          for (const entry of user.fcmTokens) {
            if (entry?.token && typeof entry.token === 'string' && !seenTokens.has(entry.token)) {
              seenTokens.add(entry.token);
              activeTargets.push({
                userId: user._id,
                token: entry.token,
                claim: entry.claim || null,
                isLegacyScalarOnly: false,
              });
            }
          }
        }
        if (user?.fcmToken && typeof user.fcmToken === 'string' && !seenTokens.has(user.fcmToken)) {
          seenTokens.add(user.fcmToken);
          // P2: Find corresponding fcmTokens entry by exact token string to obtain its true claim
          const matchingEntry = Array.isArray(user.fcmTokens)
            ? user.fcmTokens.find((t) => t.token === user.fcmToken)
            : null;

          activeTargets.push({
            userId: user._id,
            token: user.fcmToken,
            claim: matchingEntry?.claim || null,
            isLegacyScalarOnly: !matchingEntry,
          });
        }

        if (activeTargets.length > 0) {
          const pushResults = await Promise.allSettled(
            activeTargets.map((target) =>
              dispatchFcmPush(target, title, body, {
                ...data,
                recipientId: recipient.toString(),
                notificationId: notification._id.toString(),
                type,
              })
            )
          );
          pushSent = pushResults.some(
            (r) => r.status === 'fulfilled' && r.value === true
          );
        }
      } catch (pushErr) {
        console.error('Push delivery error (non-fatal):', pushErr?.message || pushErr);
      }
    }

    return { notification, created: true, pushSent };
  } catch (err) {
    console.error('Notification persistence error (non-fatal):', err?.message || err);
    return null;
  }
}

/**
 * Creates in-app notifications for multiple recipients (e.g. expense added)
 * and sends multicast FCM push where tokens are registered.
 */
async function createMulticastNotifications({
  recipients = [],
  sender = null,
  type,
  title,
  body,
  data = {},
  dedupePrefix = null,
  sendPush = true,
}) {
  if (!Array.isArray(recipients) || recipients.length === 0) return [];

  const results = [];
  const tokensToPush = [];
  const tokenToRecipientMap = new Map();

  for (const recipientId of recipients) {
    try {
      const recipientStr = recipientId.toString();
      const dedupeKey = dedupePrefix ? `${dedupePrefix}:${recipientStr}` : null;

      if (dedupeKey) {
        const existing = await Notification.findOne({ recipient: recipientId, dedupeKey });
        if (existing) {
          results.push({ recipient: recipientId, notification: existing, created: false });
          continue;
        }
      }

      let notif;
      try {
        notif = await Notification.create({
          recipient: recipientId,
          sender,
          type,
          title,
          body,
          data,
          dedupeKey,
        });
        results.push({ recipient: recipientId, notification: notif, created: true });
      } catch (createErr) {
        if (createErr && (createErr.code === 11000 || createErr.message?.includes('E11000'))) {
          console.log(`Multicast duplicate race caught for recipient ${recipientId} and dedupeKey ${dedupeKey}; treating as idempotent.`);
          const existing = await Notification.findOne({ recipient: recipientId, dedupeKey });
          results.push({ recipient: recipientId, notification: existing, created: false });
        } else {
          throw createErr;
        }
      }
    } catch (err) {
      console.error(`Failed to create notification for recipient ${recipientId}:`, err?.message || err);
    }
  }

  // Push delivery to active tokens
  if (sendPush && getMessaging && results.length > 0) {
    try {
      const messaging = typeof getMessaging === 'function' ? getMessaging() : null;
      if (!messaging || typeof messaging.sendEach !== 'function') {
        console.warn(
          'Firebase Messaging sendEach is unavailable; skipping multicast push dispatch to ensure recipient safety'
        );
        return results;
      }

      const createdRecipientIds = results.filter((r) => r.created).map((r) => r.recipient);
      const users = await User.find({
        _id: { $in: createdRecipientIds },
        $or: [
          { fcmToken: { $ne: null } },
          { 'fcmTokens.0': { $exists: true } },
        ],
      }).select('_id fcmToken fcmTokens fcmClaim');

      const targets = [];
      const tokens = [];
      const seenTokenKeys = new Set();

      for (const u of users) {
        if (Array.isArray(u.fcmTokens) && u.fcmTokens.length > 0) {
          for (const entry of u.fcmTokens) {
            if (entry?.token && typeof entry.token === 'string') {
              const key = `${u._id.toString()}:${entry.token}`;
              if (!seenTokenKeys.has(key)) {
                seenTokenKeys.add(key);
                tokens.push(entry.token);
                targets.push({
                  userId: u._id,
                  token: entry.token,
                  claim: entry.claim || null,
                  isLegacyScalarOnly: false,
                });
              }
            }
          }
        }
        if (u.fcmToken && typeof u.fcmToken === 'string') {
          const key = `${u._id.toString()}:${u.fcmToken}`;
          if (!seenTokenKeys.has(key)) {
            seenTokenKeys.add(key);
            tokens.push(u.fcmToken);

            // P2: Find matching fcmTokens entry by exact token string to obtain its true claim
            const matchingEntry = Array.isArray(u.fcmTokens)
              ? u.fcmTokens.find((t) => t.token === u.fcmToken)
              : null;

            targets.push({
              userId: u._id,
              token: u.fcmToken,
              claim: matchingEntry?.claim || null,
              isLegacyScalarOnly: !matchingEntry,
            });
          }
        }
      }

      if (tokens.length > 0) {
        const stringifiedData = Object.fromEntries(
          Object.entries(data || {}).map(([k, v]) => [k, String(v ?? '')])
        );

        const messages = targets.map((target) => {
          const notifForTarget = results.find(
            (r) => r.recipient && r.recipient.toString() === target.userId.toString()
          );
          return {
            token: target.token,
            notification: {
              title,
              body,
            },
            webpush: {
              notification: {
                icon: '/icons/icon-192.png',
                badge: '/icons/icon-192.png',
              },
              fcmOptions: {
                link: data?.groupId ? `/group.html?id=${data.groupId}` : '/dashboard.html',
              },
            },
            android: {
              priority: 'high',
              notification: {
                channelId: 'default',
                sound: 'default',
              },
            },
            data: {
              ...stringifiedData,
              recipientId: target.userId.toString(),
              ...(notifForTarget?.notification?._id
                ? { notificationId: notifForTarget.notification._id.toString() }
                : {}),
              type,
            },
          };
        });

        const multicastRes = await messaging.sendEach(messages);

        console.log(
          `Multicast push sent: ${multicastRes.successCount} successful, ${multicastRes.failureCount} failed`
        );

        // Check for stale tokens to clean up using registration identity
        if (multicastRes.failureCount > 0) {
          multicastRes.responses.forEach((resp, idx) => {
            if (!resp.success && resp.error) {
              const code = resp.error.code;
              if (
                code === 'messaging/invalid-registration-token' ||
                code === 'messaging/registration-token-not-registered' ||
                resp.error.message?.includes('NotRegistered')
              ) {
                const badTarget = targets[idx];
                pruneInvalidFcmToken(badTarget).catch(() => {});
              }
            }
          });
        }
      }
    } catch (multicastErr) {
      console.error('Multicast push error (non-fatal):', multicastErr?.message || multicastErr);
    }
  }

  return results;
}

module.exports = {
  createNotification,
  createMulticastNotifications,
  dispatchFcmPush,
  pruneInvalidFcmToken,
};

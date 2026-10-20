import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '../context/AuthContext';
import { groupsApi, paymentApi } from '../services/api';
import {
  createDuplicateGuard,
  ParsedDeepLink,
  parseDeepLink,
  pendingDeepLinkStore,
  resolveGroupForIntent,
} from '../utils/deepLink';

export function DeepLinkHandler() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const duplicateGuard = useRef(createDuplicateGuard(3000)).current;
  const isResolvingIntentRef = useRef<boolean>(false);

  // Central routing execution for a parsed deep link
  const executeDeepLinkRoute = useCallback(
    async (parsed: ParsedDeepLink) => {
      if (!parsed.isValid) return;

      if (parsed.isPaymentClaim && parsed.claimIntentId) {
        if (parsed.groupId) {
          router.push(`/group/${parsed.groupId}?claimIntentId=${parsed.claimIntentId}`);
          return;
        }

        // URL has claimIntentId but omitted groupId — safely resolve via authorized backend endpoints
        if (isResolvingIntentRef.current) return;
        isResolvingIntentRef.current = true;

        try {
          const res = await resolveGroupForIntent(
            parsed.claimIntentId,
            async () => {
              const gRes = await groupsApi.list();
              return gRes.groups;
            },
            async (gId: string) => {
              const pRes = await paymentApi.getActiveIntents(gId);
              return pRes.intents;
            }
          );

          if (res.groupId) {
            router.push(`/group/${res.groupId}?claimIntentId=${parsed.claimIntentId}`);
          } else {
            // Check status for clear feedback on expired/settled intents
            try {
              const statusRes = await paymentApi.getStatus(parsed.claimIntentId);
              Alert.alert(
                'Payment Status',
                `This payment is already in status "${statusRes.status}".`
              );
            } catch (statusErr: any) {
              const msg =
                statusErr?.status === 404
                  ? 'Payment intent not found.'
                  : statusErr?.status === 403
                  ? 'You are not authorized to view this payment.'
                  : res.error || 'Could not resolve group for this payment claim.';
              Alert.alert('Payment Notice', msg);
            }
          }
        } catch (err: any) {
          Alert.alert('Connection Error', err?.message || 'Failed to resolve payment details.');
        } finally {
          isResolvingIntentRef.current = false;
        }
        return;
      }

      // Ordinary non-payment deep link
      if (parsed.groupId) {
        router.push(`/group/${parsed.groupId}`);
      } else {
        router.push('/');
      }
    },
    [router]
  );

  // Handles raw incoming URL string (both cold start and warm start)
  const handleIncomingUrl = useCallback(
    (url: string | null) => {
      if (!url) return;
      if (duplicateGuard.isDuplicate(url)) return;

      const parsed = parseDeepLink(url);
      if (!parsed.isValid) {
        if (parsed.error && parsed.scheme === 'lendlocal') {
          Alert.alert('Invalid Link', parsed.error);
        }
        return;
      }

      // If auth is still restoring session, hold in pending store
      if (isLoading) {
        pendingDeepLinkStore.set(parsed);
        return;
      }

      // If user is logged out, hold in pending store and prompt sign-in
      if (!user) {
        pendingDeepLinkStore.set(parsed);
        router.push('/(auth)/login');
        return;
      }

      // User is logged in — execute route directly
      executeDeepLinkRoute(parsed);
    },
    [duplicateGuard, isLoading, user, router, executeDeepLinkRoute]
  );

  // 1. Warm start: Subscribe to incoming Linking URL events
  useEffect(() => {
    const subscription = Linking.addEventListener('url', (event) => {
      handleIncomingUrl(event.url);
    });

    return () => {
      subscription.remove();
    };
  }, [handleIncomingUrl]);

  // 2. Cold start: Check getInitialURL on mount
  useEffect(() => {
    let isMounted = true;

    async function checkInitialUrl() {
      try {
        const initialUrl = await Linking.getInitialURL();
        if (isMounted && initialUrl) {
          handleIncomingUrl(initialUrl);
        }
      } catch (err) {
        console.warn('Failed to retrieve initial deep link URL:', err);
      }
    }

    checkInitialUrl();

    return () => {
      isMounted = false;
    };
  }, [handleIncomingUrl]);

  // 3. Post-login and session restoration recovery:
  // When user becomes authenticated and session is loaded, resume any pending link
  useEffect(() => {
    if (!isLoading && user) {
      const pending = pendingDeepLinkStore.get();
      if (pending) {
        pendingDeepLinkStore.clear();
        executeDeepLinkRoute(pending);
      }
    }
  }, [isLoading, user, executeDeepLinkRoute]);

  return null;
}

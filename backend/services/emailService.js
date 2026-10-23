/**
 * emailService.js — Transactional Email Delivery Service for LendLocal
 *
 * Production-ready email provider abstraction supporting modern transactional providers
 * (Resend, SendGrid, Postmark) via built-in HTTPS fetch without external dependencies.
 *
 * Security & Reliability Invariants:
 * - Credentials and sender identity are read strictly from environment variables:
 *     - EMAIL_FROM (e.g. "LendLocal <noreply@lendlocal.app>")
 *     - RESEND_API_KEY or SENDGRID_API_KEY or POSTMARK_SERVER_TOKEN
 * - In production: If no provider is configured, throws a clear sanitized configuration error.
 *   Never silently pretends email delivery succeeded when no provider exists.
 * - Test/Development isolation: In-memory capture is strictly restricted to NODE_ENV === 'test'.
 *   It can NEVER accidentally become the production delivery path.
 * - Sensitive reset tokens and credentials NEVER appear in server logs or error responses.
 */

// In-memory test collector strictly scoped to NODE_ENV === 'test'
const sentEmailsTestCapture = [];

// Optional custom/mock transporter hook for unit tests
let mockTransporter = null;

const DEFAULT_EMAIL_TIMEOUT_MS = 15000;

function getEmailTimeoutMs() {
  const envTimeout = parseInt(process.env.EMAIL_TIMEOUT_MS, 10);
  return Number.isInteger(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_EMAIL_TIMEOUT_MS;
}

/**
 * Dispatches an HTTPS request to an email provider with an explicit timeout.
 * - Uses AbortSignal.timeout if supported, with AbortController fallback.
 * - Fails safely on timeout or network errors without leaking sensitive tokens or credentials.
 */
async function dispatchProviderFetch(url, options, providerName) {
  const timeoutMs = getEmailTimeoutMs();
  let signal;
  let controller = null;
  let timeoutId = null;

  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    signal = AbortSignal.timeout(timeoutMs);
  } else {
    controller = new AbortController();
    signal = controller.signal;
    timeoutId = setTimeout(() => {
      const err = new Error(`Email provider request timed out after ${timeoutMs}ms`);
      err.name = 'TimeoutError';
      controller.abort(err);
    }, timeoutMs);
  }

  try {
    const response = await fetch(url, { ...options, signal });
    return response;
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError' || signal?.aborted) {
      console.error(`[EmailService] ${providerName} delivery timed out after ${timeoutMs}ms`);
      throw new Error(`Email provider delivery timed out after ${timeoutMs}ms`);
    }
    console.error(`[EmailService] ${providerName} network error:`, err?.message || 'unknown error');
    throw new Error(`Email provider network request failed: ${err?.message || 'unknown error'}`);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Returns the detected email provider based on configured environment variables.
 */
function getActiveProvider() {
  if (mockTransporter) return 'mock';
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.SENDGRID_API_KEY) return 'sendgrid';
  if (process.env.POSTMARK_SERVER_TOKEN) return 'postmark';
  return null;
}

/**
 * Verifies whether an email provider is configured and ready.
 */
function isEmailConfigured() {
  return getActiveProvider() !== null;
}

/**
 * Helper to mask email address for safe logging.
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return 'unknown';
  return email.replace(/^(.)(.*)(@.*)$/, (_, first, middle, domain) => {
    return `${first}${'*'.repeat(Math.max(middle.length, 3))}${domain}`;
  });
}

/**
 * Sends a transactional password recovery email.
 *
 * @param {Object} params
 * @param {string} params.to - Recipient email
 * @param {string} [params.userName] - Recipient user display name
 * @param {string} params.resetUrl - Trusted password reset URL containing token
 * @param {string} [params.token] - Raw token for validation
 * @returns {Promise<Object>}
 */
async function sendPasswordResetEmail({ to, userName, resetUrl, token }) {
  if (!to || typeof to !== 'string' || !to.trim()) {
    throw new Error('Valid recipient email address is required');
  }
  if (!resetUrl || typeof resetUrl !== 'string' || !resetUrl.startsWith('https://') && !resetUrl.startsWith('http://localhost')) {
    throw new Error('Valid HTTPS password reset URL is required');
  }

  const recipientEmail = to.toLowerCase().trim();
  const name = userName ? userName.trim() : 'there';
  const sender = process.env.EMAIL_FROM || 'LendLocal <noreply@lendlocal.app>';
  const subject = 'Reset your LendLocal password';

  const textBody = `Hi ${name},\n\nYou requested to reset your password for your LendLocal account.\n\nClick the link below to set a new password:\n${resetUrl}\n\nThis recovery link is valid for 1 hour. If you did not make this request, you can safely ignore this email.\n\nBest,\nThe LendLocal Team`;

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #111;">
      <h2 style="color: #10B981; margin-bottom: 16px;">LendLocal</h2>
      <p style="font-size: 16px; line-height: 1.5;">Hi ${escapeHtml(name)},</p>
      <p style="font-size: 16px; line-height: 1.5;">You requested to reset your password for your LendLocal account.</p>
      <div style="margin: 28px 0;">
        <a href="${resetUrl}" style="background-color: #10B981; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
          Reset Password
        </a>
      </div>
      <p style="font-size: 14px; color: #666; line-height: 1.5;">This link is valid for 1 hour. If you did not make this request, your account remains secure and no action is required.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="font-size: 12px; color: #999;">If the button above does not work, copy and paste this URL into your browser:<br/><span style="word-break: break-all;">${resetUrl}</span></p>
    </div>
  `;

  const isProd = process.env.NODE_ENV === 'production';
  const provider = getActiveProvider();

  // Test environment: allow in-memory test capture if mock or test mode is enabled
  if (process.env.NODE_ENV === 'test' && !provider) {
    const tokenMasked = token ? `${token.slice(0, 4)}...${token.slice(-4)}` : null;
    sentEmailsTestCapture.push({
      to: recipientEmail,
      sender,
      subject,
      text: textBody,
      resetUrl,
      tokenMasked,
      sentAt: new Date(),
    });
    return { success: true, provider: 'test-capture' };
  }

  // Production check: Must have a real configured provider
  if (!provider) {
    const errorMsg = 'Transactional email provider is not configured. Set RESEND_API_KEY, SENDGRID_API_KEY, or POSTMARK_SERVER_TOKEN and EMAIL_FROM.';
    console.error(`[EmailService] Configuration error: ${errorMsg}`);
    throw new Error(errorMsg);
  }

  // Provider Dispatch via native HTTPS fetch
  if (provider === 'mock') {
    return await mockTransporter({ to: recipientEmail, from: sender, subject, text: textBody, html: htmlBody });
  }

  if (provider === 'resend') {
    const response = await dispatchProviderFetch(
      'https://api.resend.com/emails',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: sender,
          to: [recipientEmail],
          subject,
          text: textBody,
          html: htmlBody,
        }),
      },
      'Resend'
    );

    if (!response.ok) {
      console.error('[EmailService] Resend delivery error:', response.status);
      throw new Error(`Email provider delivery failed with status ${response.status}`);
    }

    const data = await response.json();
    console.log(`[EmailService] Password reset sent to ${maskEmail(recipientEmail)} via Resend`);
    return { success: true, messageId: data.id, provider: 'resend' };
  }

  if (provider === 'sendgrid') {
    const response = await dispatchProviderFetch(
      'https://api.sendgrid.com/v3/mail/send',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: recipientEmail }] }],
          from: { email: sender },
          subject,
          content: [
            { type: 'text/plain', value: textBody },
            { type: 'text/html', value: htmlBody },
          ],
        }),
      },
      'SendGrid'
    );

    if (!response.ok) {
      console.error('[EmailService] SendGrid delivery error:', response.status);
      throw new Error(`Email provider delivery failed with status ${response.status}`);
    }

    console.log(`[EmailService] Password reset sent to ${maskEmail(recipientEmail)} via SendGrid`);
    return { success: true, provider: 'sendgrid' };
  }

  if (provider === 'postmark') {
    const response = await dispatchProviderFetch(
      'https://api.postmarkapp.com/email',
      {
        method: 'POST',
        headers: {
          'X-Postmark-Server-Token': process.env.POSTMARK_SERVER_TOKEN,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          From: sender,
          To: recipientEmail,
          Subject: subject,
          TextBody: textBody,
          HtmlBody: htmlBody,
        }),
      },
      'Postmark'
    );

    if (!response.ok) {
      console.error('[EmailService] Postmark delivery error:', response.status);
      throw new Error(`Email provider delivery failed with status ${response.status}`);
    }

    console.log(`[EmailService] Password reset sent to ${maskEmail(recipientEmail)} via Postmark`);
    return { success: true, provider: 'postmark' };
  }

  throw new Error(`Unsupported email provider: ${provider}`);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Testing helpers: strictly available for unit test harness
 */
function __getSentEmails() {
  return [...sentEmailsTestCapture];
}

function __clearSentEmails() {
  sentEmailsTestCapture.length = 0;
}

function __setMockTransporter(fn) {
  mockTransporter = fn;
}

function __clearMockTransporter() {
  mockTransporter = null;
}

module.exports = {
  sendPasswordResetEmail,
  isEmailConfigured,
  getActiveProvider,
  maskEmail,
  DEFAULT_EMAIL_TIMEOUT_MS,
  getEmailTimeoutMs,
  __getSentEmails,
  __clearSentEmails,
  __setMockTransporter,
  __clearMockTransporter,
};

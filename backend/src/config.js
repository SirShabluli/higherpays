'use strict';
require('dotenv').config();

// Central config. Real secrets come from the environment (.env locally,
// the host's secret manager in production) — never hard-coded here.
function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    // In production we refuse to boot without critical secrets.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Missing required env var: ${name}`);
    }
    return undefined;
  }
  return v;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),

  databaseUrl: required('DATABASE_URL', 'postgres://postgres@localhost:5432/higherpays'),

  // JWT signing. MUST be set to a long random value in production.
  jwtSecret: required('JWT_SECRET', 'dev-only-insecure-secret-change-me'),
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTokenDays: parseInt(process.env.REFRESH_TOKEN_DAYS || '30', 10),

  // Turn on to have the app set app.workspace_id / app.user_id per request
  // (required if you enabled Row-Level Security in migration 002/003).
  useRls: process.env.USE_RLS === 'true',

  // QRMoney (payment provider)
  // Path template for the provider refund call. Set once QRMoney supplies the spec,
  // e.g. '/payments/refund/pr/{paymentRequestId}'. Unset => refunds must be recorded as external.
  // One HigherPays-owned Telegram bot delivers to every workspace's chat.
  // Workspaces configure only their chat id — never a secret.
  // EUR-only for now. FX (closing-date cross-rates, per-currency reserves,
  // EUR-denominated fixed fees converted into the transaction currency) is
  // deliberately out of scope. Add a currency here to re-enable multi-currency.
  supportedCurrencies: (process.env.SUPPORTED_CURRENCIES || 'EUR').split(',').map((c) => c.trim().toUpperCase()),
  // Mantapay (replacing QRMoney). Hosted page base; the per-merchant hash key
  // resolves via provider_config_ref -> env var, never stored in the database.
  mantapayHostedBase: process.env.MANTAPAY_HOSTED_BASE || 'https://uiservices.mantapay.biz',
  // Status check / server-to-server live on a DIFFERENT host to the hosted page.
  mantapaySearchBase: process.env.MANTAPAY_SEARCH_BASE || 'https://webservices.mantapay.biz',
  // Webservices login (Search API, payouts). Use the API-user role so a human
  // changing their portal password cannot break the integration.
  mantapayApiEmail: process.env.MANTAPAY_API_EMAIL || null,
  mantapayApiPassword: process.env.MANTAPAY_API_PASSWORD || null,
  mantapayAppToken: process.env.MANTAPAY_APP_TOKEN || null,
  mantapaySearchSalt: process.env.MANTAPAY_SEARCH_SALT || null,
  mantapayProcessBase: process.env.MANTAPAY_PROCESS_BASE || 'https://process.mantapay.biz',
  // MantaPay's refund flow is a two-step request approved by their admins and is
  // not implemented yet. Until then the console RECORDS refunds issued in their
  // dashboard. Flip on once the refund API is built.
  mantapayRefundEnabled: String(process.env.MANTAPAY_REFUND_ENABLED || '') === 'true',
  mantapayMerchantId: process.env.MANTAPAY_MERCHANT_ID || null,
  mantapayHashKey: process.env.MANTAPAY_HASH_KEY || null,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || null,
  telegramApiBase: process.env.TELEGRAM_API_BASE || 'https://api.telegram.org',
  // Which paymentRequestStatusId code table the provider is sending.
  //   'v2'         their integration notice: 2=Pending, 4=Declined
  //   'legacy'     the original doc:         2=Unpaid(declined), 4=Pending
  //   'transition' treats 2 and 4 as non-final, so it cannot fabricate a decline
  //                under EITHER scheme. Default, because the notice shipped with
  //                an unfilled effective date ("<release date>").
  // Switch to 'v2' the moment the provider confirms the cutover has happened.
  // Public base URL of THIS backend, used to build each workspace's notifyUrl
  // (e.g. https://api.higherpays.com). If unset, we omit notifyUrl and rely on
  // the merchant profile's default configured at QRMoney.
  webhookPublicBase: process.env.WEBHOOK_PUBLIC_BASE || null,
  // QRMoney checkout links expire after this many minutes (their TTL).
  linkTtlMinutes: parseInt(process.env.LINK_TTL_MINUTES || '10', 10),
};

if (config.env === 'production' && config.jwtSecret === 'dev-only-insecure-secret-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}

// Row-Level Security IS the tenant boundary. Booting production without it would
// silently expose every agency's data to every other agency.
if (config.env === 'production' && !config.useRls) {
  throw new Error('USE_RLS must be true in production (tenant isolation depends on it)');
}

module.exports = config;

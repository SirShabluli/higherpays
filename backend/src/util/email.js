'use strict';

// Email sender — STUB. Logs instead of sending so invites work end-to-end now.
// Swap the body for a real provider (Postmark/SES/Resend) at go-live; the rest
// of the code doesn't change.
async function sendEmail({ to, subject, body }) {
  console.log(`[email:STUB] to=${to} subject="${subject}"\n${body}\n`);
  return { queued: true, to, subject };
}

module.exports = { sendEmail };

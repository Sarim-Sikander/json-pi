'use strict';
const lib = require('./_lib');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const FROM_ADDRESS = 'Json-Pi <contact@json-pi.com>';
const REPLY_TO_ADDRESS = 'sarimsikander24@gmail.com';

const DAILY_LIMIT = 30;

function htmlEscape(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function buildPlainText(replyBody, originalSubject, originalMessage, originalDate) {
  return (
    replyBody.trim() + '\n\n' +
    '— Sarim Sikander\n' +
    'https://json-pi.com\n\n' +
    '---\n' +
    'On ' + originalDate + ', you wrote:\n' +
    '> ' + originalMessage.replace(/\n/g, '\n> ') + '\n'
  );
}

function buildHtml(replyBody, originalSubject, originalMessage, originalDate) {
  const reply = htmlEscape(replyBody).replace(/\n/g, '<br>');
  const quoted = htmlEscape(originalMessage).replace(/\n/g, '<br>');
  return (
    '<!DOCTYPE html><html><body style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; font-size: 14px; line-height: 1.6; color: #171717; max-width: 600px; margin: 0; padding: 20px;">' +
      '<div style="font-size: 14px; color: #171717;">' + reply + '</div>' +
      '<div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e5e5; color: #525252; font-size: 13px;">' +
        '— Sarim Sikander<br>' +
        '<a href="https://json-pi.com" style="color: #2563eb; text-decoration: none;">json-pi.com</a>' +
      '</div>' +
      '<div style="margin-top: 28px; padding-top: 16px; border-top: 1px solid #e5e5e5; color: #737373; font-size: 12px;">' +
        '<div style="margin-bottom: 8px;">On ' + htmlEscape(originalDate) + ', you wrote:</div>' +
        '<div style="padding-left: 12px; border-left: 3px solid #d4d4d4; color: #525252; font-size: 12.5px; line-height: 1.5;">' + quoted + '</div>' +
      '</div>' +
    '</body></html>'
  );
}

async function countTodayReplies() {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const url = SUPABASE_URL + '/rest/v1/replies?select=id&created_at=gte.' + encodeURIComponent(todayStart.toISOString());
  const r = await fetch(url, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Prefer': 'count=exact',
    },
  });
  if (!r.ok) return 0;
  const range = r.headers.get('content-range') || '';
  const total = parseInt(range.split('/').pop(), 10);
  return Number.isFinite(total) ? total : 0;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return lib.handleOptions();
  if (event.httpMethod !== 'POST') return lib.error(405, 'method_not_allowed', 'Use POST.');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return lib.error(503, 'service_unavailable', 'Storage not configured.');
  if (!ADMIN_TOKEN) return lib.error(503, 'service_unavailable', 'Admin token not configured.');
  if (!RESEND_API_KEY) return lib.error(503, 'service_unavailable', 'Email service not configured. Set RESEND_API_KEY.');

  const headers = event.headers || {};
  const provided = headers['x-admin-token'] || headers['X-Admin-Token'] || '';
  if (provided !== ADMIN_TOKEN) return lib.error(401, 'unauthorized', 'Invalid or missing admin token.');

  const body = lib.readBody(event);
  if (!body) return lib.error(400, 'missing_body', 'Request body required.');
  if (body.__tooLarge) return lib.error(413, 'payload_too_large', 'Body too large.');
  if (body.__badJson) return lib.error(400, 'invalid_request', body.error);

  const { contact_id, reply_body } = body;
  if (!contact_id) return lib.error(400, 'missing_field', '"contact_id" is required.');
  if (!reply_body || typeof reply_body !== 'string' || !reply_body.trim()) {
    return lib.error(400, 'missing_field', '"reply_body" is required.');
  }
  if (reply_body.length > 10000) return lib.error(400, 'field_too_long', 'Reply exceeds 10000 characters.');

  // Rate limit check
  try {
    const count = await countTodayReplies();
    if (count >= DAILY_LIMIT) {
      return lib.error(429, 'rate_limited', 'Daily reply limit reached (' + DAILY_LIMIT + '/day).');
    }
  } catch (e) {
    // If rate-limit check fails, log but proceed (don't block legitimate sends due to db hiccup).
    console.warn('Rate limit check failed:', e.message);
  }

  // Fetch the original contact
  let contact;
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/contacts?id=eq.' + encodeURIComponent(contact_id) + '&select=*', {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      },
    });
    if (!r.ok) return lib.error(500, 'storage_error', 'Could not fetch contact.');
    const arr = await r.json();
    if (!arr.length) return lib.error(404, 'not_found', 'Contact not found.');
    contact = arr[0];
  } catch (e) {
    return lib.error(500, 'internal_error', 'Database error: ' + e.message);
  }

  if (!contact.email) return lib.error(400, 'no_email', 'Contact has no email — cannot send reply.');

  const subject = 'Re: ' + (contact.subject || '(no subject)');
  const originalDate = new Date(contact.created_at).toUTCString();
  const text = buildPlainText(reply_body, contact.subject, contact.message, originalDate);
  const html = buildHtml(reply_body, contact.subject, contact.message, originalDate);

  // Send via Resend
  let resendId = null;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [contact.email],
        reply_to: REPLY_TO_ADDRESS,
        subject,
        text,
        html,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('Resend send failed:', r.status, data);
      return lib.error(502, 'email_send_failed', data.message || 'Email service rejected the message.');
    }
    resendId = data.id || null;
  } catch (e) {
    console.error('Resend network error:', e);
    return lib.error(502, 'email_send_failed', 'Could not reach email service: ' + e.message);
  }

  // Log to replies table
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/replies', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        contact_id: contact.id,
        to_email: contact.email,
        subject,
        body: reply_body,
        resend_id: resendId,
      }),
    });
    if (!r.ok) {
      // Email was sent, but we couldn't log it. Don't fail the request.
      console.warn('Reply log failed:', await r.text());
    }
  } catch (e) {
    console.warn('Reply log error:', e.message);
  }

  return lib.respond(200, { ok: true, sent_to: contact.email, resend_id: resendId });
};

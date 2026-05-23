'use strict';
const lib = require('./_lib');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return lib.handleOptions();
  if (event.httpMethod !== 'POST') return lib.error(405, 'method_not_allowed', 'Use POST.');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return lib.error(503, 'service_unavailable', 'Contact storage not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars.');
  }

  const body = lib.readBody(event);
  if (!body) return lib.error(400, 'missing_body', 'Request body required.');
  if (body.__tooLarge) return lib.error(413, 'payload_too_large', 'Body too large.');
  if (body.__badJson) return lib.error(400, 'invalid_request', body.error);

  const { name, email, subject, message, website } = body;

  // Honeypot — if it's filled, the submission is from a bot. Silent success.
  if (website && website.length > 0) {
    return lib.respond(200, { ok: true, accepted: true });
  }

  // Validate
  if (!subject || typeof subject !== 'string') return lib.error(400, 'missing_field', 'Subject is required.');
  if (!message || typeof message !== 'string') return lib.error(400, 'missing_field', 'Message is required.');
  if (subject.length > 200) return lib.error(400, 'field_too_long', 'Subject exceeds 200 characters.');
  if (message.length > 5000) return lib.error(400, 'field_too_long', 'Message exceeds 5000 characters.');
  if (name && name.length > 100) return lib.error(400, 'field_too_long', 'Name exceeds 100 characters.');
  if (email && email.length > 120) return lib.error(400, 'field_too_long', 'Email exceeds 120 characters.');
  if (email && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
    return lib.error(400, 'invalid_email', 'Email looks invalid.');
  }

  const userAgent = event.headers && (event.headers['user-agent'] || event.headers['User-Agent']) || '';
  const ipHeader = event.headers && (event.headers['x-forwarded-for'] || event.headers['x-nf-client-connection-ip']);
  const ip = (ipHeader || '').split(',')[0].trim() || null;

  const row = {
    name:    name || null,
    email:   email || null,
    subject: subject.trim(),
    message: message.trim(),
    user_agent: userAgent.slice(0, 500),
    ip_address: ip ? ip.slice(0, 64) : null,
  };

  try {
    const response = await fetch(SUPABASE_URL + '/rest/v1/contacts', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(row),
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error('Supabase insert failed:', response.status, errText);
      return lib.error(500, 'storage_error', 'Could not save your message. Please try again later.');
    }
    return lib.respond(200, { ok: true });
  } catch (e) {
    console.error('Contact handler error:', e);
    return lib.error(500, 'internal_error', 'Server error: ' + e.message);
  }
};

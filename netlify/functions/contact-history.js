'use strict';
const lib = require('./_lib');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return lib.handleOptions();
  if (event.httpMethod !== 'GET') return lib.error(405, 'method_not_allowed', 'Use GET.');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return lib.error(503, 'service_unavailable', 'Storage not configured.');
  }
  if (!ADMIN_TOKEN) {
    return lib.error(503, 'service_unavailable', 'Admin token not configured on server.');
  }

  // Auth: check X-Admin-Token header (case-insensitive)
  const headers = event.headers || {};
  const provided = headers['x-admin-token'] || headers['X-Admin-Token'] || '';
  if (provided !== ADMIN_TOKEN) {
    return lib.error(401, 'unauthorized', 'Invalid or missing admin token.');
  }

  try {
    // Fetch all contacts, newest first
    const response = await fetch(
      SUPABASE_URL + '/rest/v1/contacts?select=id,name,email,subject,message,created_at,user_agent,ip_address&order=created_at.desc&limit=1000',
      {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        },
      }
    );
    if (!response.ok) {
      const errText = await response.text();
      console.error('Supabase select failed:', response.status, errText);
      return lib.error(500, 'storage_error', 'Could not load contacts.');
    }
    const contacts = await response.json();
    return lib.respond(200, { ok: true, contacts });
  } catch (e) {
    console.error('Contact-history handler error:', e);
    return lib.error(500, 'internal_error', 'Server error: ' + e.message);
  }
};

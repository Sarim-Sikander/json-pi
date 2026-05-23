'use strict';

const lib = require('./_lib');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return lib.handleOptions();
  if (event.httpMethod !== 'POST') return lib.error(405, 'method_not_allowed', 'Use POST.');

  const body = lib.readBody(event);
  if (!body) return lib.error(400, 'missing_body', 'Request body required.');
  if (body.__tooLarge) return lib.error(413, 'payload_too_large', 'Body exceeds 5 MB limit.');
  if (body.__badJson) return lib.error(400, 'invalid_request', 'Request body is not valid JSON: ' + body.error);

  const { text, format, query } = body;
  if (typeof text !== 'string') return lib.error(400, 'missing_field', 'Field "text" is required.');
  if (typeof query !== 'string') return lib.error(400, 'missing_field', 'Field "query" is required.');

  try {
    const parsed = lib.parseDocument(text, format || 'json', true);
    const q = lib.parseQuery(query);
    if (!q.ok) return lib.error(400, 'invalid_query', q.error);
    const results = lib.evaluateQuery(parsed.value, q.tokens);
    return lib.respond(200, { ok: true, results });
  } catch (e) {
    return lib.error(e.httpStatus || 400, e.code || 'query_error', e.message, e.details);
  }
};

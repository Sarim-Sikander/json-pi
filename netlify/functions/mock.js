'use strict';
const lib = require('./_lib');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return lib.handleOptions();
  if (event.httpMethod !== 'POST') return lib.error(405, 'method_not_allowed', 'Use POST.');

  const body = lib.readBody(event);
  if (!body) return lib.error(400, 'missing_body', 'Request body required.');
  if (body.__tooLarge) return lib.error(413, 'payload_too_large', 'Body exceeds 5 MB limit.');
  if (body.__badJson) return lib.error(400, 'invalid_request', body.error);

  const { schema, count } = body;
  if (!schema || typeof schema !== 'object') return lib.error(400, 'missing_field', 'Field "schema" (object) is required.');
  const n = Math.max(1, Math.min(1000, parseInt(count, 10) || 1));

  const records = [];
  for (let i = 0; i < n; i++) records.push(lib.generateMockFromSchema(schema));
  return lib.respond(200, { ok: true, records, count: n });
};

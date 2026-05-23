'use strict';
const lib = require('./_lib');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return lib.handleOptions();
  if (event.httpMethod !== 'POST') return lib.error(405, 'method_not_allowed', 'Use POST.');

  const body = lib.readBody(event);
  if (!body) return lib.error(400, 'missing_body', 'Request body required.');
  if (body.__tooLarge) return lib.error(413, 'payload_too_large', 'Body exceeds 5 MB limit.');
  if (body.__badJson) return lib.error(400, 'invalid_request', body.error);

  const { a, b, format, ignore_order } = body;
  if (typeof a !== 'string' || typeof b !== 'string') return lib.error(400, 'missing_field', 'Both "a" and "b" (strings) are required.');

  try {
    const aDoc = lib.parseDocument(a, format || 'json', true).value;
    const bDoc = lib.parseDocument(b, format || 'json', true).value;
    const result = lib.computeDiff(aDoc, bDoc, '$', { ignoreOrder: !!ignore_order });
    return lib.respond(200, {
      ok: true,
      added: result.added,
      removed: result.removed,
      changed: result.changed,
      unchanged_count: result.unchanged,
    });
  } catch (e) {
    return lib.error(e.httpStatus || 400, e.code || 'diff_error', e.message, e.details);
  }
};

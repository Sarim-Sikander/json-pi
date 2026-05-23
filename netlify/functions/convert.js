'use strict';

const lib = require('./_lib');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return lib.handleOptions();
  if (event.httpMethod !== 'POST') return lib.error(405, 'method_not_allowed', 'Use POST.');

  const body = lib.readBody(event);
  if (!body) return lib.error(400, 'missing_body', 'Request body required.');
  if (body.__tooLarge) return lib.error(413, 'payload_too_large', 'Body exceeds 5 MB limit.');
  if (body.__badJson) return lib.error(400, 'invalid_request', 'Request body is not valid JSON: ' + body.error);

  const { text, from, to, auto_fix } = body;
  if (typeof text !== 'string') return lib.error(400, 'missing_field', 'Field "text" is required.');
  if (!from || !to) return lib.error(400, 'missing_field', 'Fields "from" and "to" are required.');
  if (!['json', 'yaml'].includes(from) || !['json', 'yaml'].includes(to)) {
    return lib.error(400, 'invalid_format', 'Both "from" and "to" must be "json" or "yaml".');
  }

  const useAutoFix = auto_fix !== false;
  try {
    const parsed = lib.parseDocument(text, from, useAutoFix);
    let result;
    if (to === 'json') result = JSON.stringify(parsed.value, null, 2);
    else result = lib.yaml.dump(parsed.value, { indent: 2, lineWidth: 120, noRefs: true });
    return lib.respond(200, { ok: true, result, repairs: parsed.repairs });
  } catch (e) {
    return lib.error(e.httpStatus || 400, e.code || 'convert_error', e.message, e.details);
  }
};

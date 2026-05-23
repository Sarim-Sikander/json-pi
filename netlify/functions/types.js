'use strict';

const lib = require('./_lib');

function buildTypes(value) {
  if (value === null || typeof value !== 'object') return lib.inferType(value);
  if (Array.isArray(value)) return value.map(buildTypes);
  const out = {};
  for (const k of Object.keys(value)) out[k] = buildTypes(value[k]);
  return out;
}

function summary(value, counts) {
  counts = counts || {};
  const t = lib.inferType(value);
  counts[t] = (counts[t] || 0) + 1;
  if (Array.isArray(value)) value.forEach(v => summary(v, counts));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => summary(v, counts));
  return counts;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return lib.handleOptions();
  if (event.httpMethod !== 'POST') return lib.error(405, 'method_not_allowed', 'Use POST.');

  const body = lib.readBody(event);
  if (!body) return lib.error(400, 'missing_body', 'Request body required.');
  if (body.__tooLarge) return lib.error(413, 'payload_too_large', 'Body exceeds 5 MB limit.');
  if (body.__badJson) return lib.error(400, 'invalid_request', 'Request body is not valid JSON: ' + body.error);

  const { text, format } = body;
  if (typeof text !== 'string') return lib.error(400, 'missing_field', 'Field "text" is required.');

  try {
    const parsed = lib.parseDocument(text, format || 'json', true);
    const types = buildTypes(parsed.value);
    const summaryCounts = summary(parsed.value);
    delete summaryCounts.object;
    delete summaryCounts.array;
    return lib.respond(200, { ok: true, types, summary: summaryCounts });
  } catch (e) {
    return lib.error(e.httpStatus || 400, e.code || 'types_error', e.message, e.details);
  }
};

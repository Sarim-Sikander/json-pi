'use strict';

const yaml = require('js-yaml');

const MAX_BODY_BYTES = 5 * 1024 * 1024;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function respond(status, body, extraHeaders) {
  return {
    statusCode: status,
    headers: Object.assign(
      { 'Content-Type': 'application/json' },
      CORS_HEADERS,
      extraHeaders || {}
    ),
    body: JSON.stringify(body),
  };
}

function error(status, code, message, details) {
  const body = { ok: false, error: code, message };
  if (details) body.details = details;
  return respond(status, body);
}

function handleOptions() {
  return { statusCode: 204, headers: CORS_HEADERS, body: '' };
}

function readBody(event) {
  if (!event.body) return null;
  if (event.body.length > MAX_BODY_BYTES) {
    return { __tooLarge: true };
  }
  try {
    return JSON.parse(event.body);
  } catch (e) {
    return { __badJson: true, error: e.message };
  }
}

function parseJsonStrict(text) {
  return JSON.parse(text);
}

function autoFixJson(text) {
  const notes = [];
  let s = text.trim();
  if (!s) throw new Error('Input is empty.');
  if (s.charCodeAt(0) === 0xFEFF) { s = s.slice(1); notes.push('Removed byte-order mark (BOM).'); }
  const before = s;
  s = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  if (s !== before) notes.push('Replaced smart quotes with straight quotes.');
  s = stripCommentsAware(s, notes);
  s = replaceOutsideStrings(s, /\bTrue\b/g, 'true', notes, 'Converted Python True -> true.');
  s = replaceOutsideStrings(s, /\bFalse\b/g, 'false', notes, 'Converted Python False -> false.');
  s = replaceOutsideStrings(s, /\bNone\b/g, 'null', notes, 'Converted Python None -> null.');
  s = replaceOutsideStrings(s, /\bNaN\b/g, 'null', notes, 'Converted NaN -> null.');
  s = replaceOutsideStrings(s, /\bundefined\b/g, 'null', notes, 'Converted undefined -> null.');
  s = quoteUnquotedKeys(s, notes);
  s = singleToDoubleQuoted(s, notes);
  s = insertMissingCommas(s, notes);
  const beforeT = s;
  s = s.replace(/,(\s*[}\]])/g, '$1');
  if (s !== beforeT) notes.push('Removed trailing commas.');
  s = balanceBrackets(s, notes);
  return { fixed: s, notes };
}

function stripCommentsAware(s, notes) {
  let out = '';
  let i = 0;
  let inStr = null;
  let removed = false;
  while (i < s.length) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (c === '\\' && i + 1 < s.length) { out += s[i + 1]; i += 2; continue; }
      if (c === inStr) inStr = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; out += c; i++; continue; }
    if (c === '/' && s[i + 1] === '/') {
      let j = i + 2;
      while (j < s.length && s[j] !== '\n') j++;
      removed = true;
      i = j;
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      let j = i + 2;
      while (j < s.length - 1 && !(s[j] === '*' && s[j + 1] === '/')) j++;
      removed = true;
      i = Math.min(s.length, j + 2);
      continue;
    }
    out += c;
    i++;
  }
  if (removed) notes.push('Removed // and /* */ comments.');
  return out;
}

function replaceOutsideStrings(s, regex, replacement, notes, msg) {
  let changed = false;
  const chunks = [];
  let buf = '';
  let inStr = null;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (inStr) {
      buf += c;
      if (c === '\\' && i + 1 < s.length) { buf += s[i + 1]; i += 2; continue; }
      if (c === inStr) { chunks.push({ str: true, t: buf }); buf = ''; inStr = null; }
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      if (buf) { chunks.push({ str: false, t: buf }); buf = ''; }
      buf = c; inStr = c; i++;
      continue;
    }
    buf += c; i++;
  }
  if (buf) chunks.push({ str: inStr != null, t: buf });
  const out = chunks.map(ch => {
    if (ch.str) return ch.t;
    const r = ch.t.replace(regex, replacement);
    if (r !== ch.t) changed = true;
    return r;
  }).join('');
  if (changed && msg) notes.push(msg);
  return out;
}

function quoteUnquotedKeys(s, notes) {
  let changed = false;
  const re = /([{,]\s*)([A-Za-z_$][A-Za-z0-9_$\-\.]*)(\s*):/g;
  const result = replaceOutsideStrings(s, re, (m, p1, key, ws) => {
    changed = true;
    return p1 + '"' + key + '"' + ws + ':';
  }, notes, '');
  if (changed) notes.push('Quoted unquoted keys.');
  return result;
}

function singleToDoubleQuoted(s, notes) {
  let changed = false;
  let out = '';
  let i = 0;
  let inStr = null;
  while (i < s.length) {
    const c = s[i];
    if (inStr === '"') {
      out += c;
      if (c === '\\' && i + 1 < s.length) { out += s[i + 1]; i += 2; continue; }
      if (c === '"') inStr = null;
      i++; continue;
    }
    if (inStr === "'") {
      if (c === '\\' && i + 1 < s.length) {
        if (s[i + 1] === "'") { out += "'"; i += 2; continue; }
        out += c + s[i + 1]; i += 2; continue;
      }
      if (c === "'") { out += '"'; inStr = null; i++; continue; }
      if (c === '"') { out += '\\"'; i++; continue; }
      out += c; i++; continue;
    }
    if (c === '"') { inStr = '"'; out += c; i++; continue; }
    if (c === "'") { inStr = "'"; out += '"'; i++; changed = true; continue; }
    out += c; i++;
  }
  if (changed) notes.push('Converted single-quoted strings to double-quoted strings.');
  return out;
}

function insertMissingCommas(s, notes) {
  let out = '';
  let i = 0;
  let inStr = null;
  const stack = [];
  let inserted = 0;
  let lastNonWs = '';
  function startsValue(ch) {
    return ch === '"' || ch === '{' || ch === '[' || ch === '-' || /[0-9A-Za-z_]/.test(ch);
  }
  function maybeInsert(next) {
    if (!stack.length) return;
    const last = lastNonWs;
    if (!last || last === ',' || last === ':' || last === '{' || last === '[') return;
    const lastIsEnd = (last === '"' || last === '}' || last === ']' || /[A-Za-z0-9_]/.test(last));
    if (!lastIsEnd) return;
    if (!startsValue(next)) return;
    out += ',';
    inserted++;
  }
  while (i < s.length) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (c === '\\' && i + 1 < s.length) { out += s[i + 1]; i += 2; continue; }
      if (c === inStr) { inStr = null; lastNonWs = '"'; }
      i++; continue;
    }
    if (c === '"') { maybeInsert(c); inStr = '"'; out += c; lastNonWs = ''; i++; continue; }
    if (/\s/.test(c)) { out += c; i++; continue; }
    if (c === '{' || c === '[') { maybeInsert(c); stack.push(c); out += c; lastNonWs = c; i++; continue; }
    if (c === '}' || c === ']') { stack.pop(); out += c; lastNonWs = c; i++; continue; }
    if (c === ',' || c === ':') { out += c; lastNonWs = c; i++; continue; }
    if (/[A-Za-z0-9_+\-.]/.test(c)) {
      maybeInsert(c);
      let tok = '';
      while (i < s.length && /[A-Za-z0-9_+\-.eE]/.test(s[i])) { tok += s[i]; i++; }
      out += tok;
      lastNonWs = tok[tok.length - 1];
      continue;
    }
    out += c; lastNonWs = c; i++;
  }
  if (inserted > 0) notes.push('Inserted ' + inserted + ' missing comma(s).');
  return out;
}

function balanceBrackets(s, notes) {
  let inStr = null;
  let open = 0, close = 0, oSq = 0, cSq = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '{') open++; else if (c === '}') close++;
    else if (c === '[') oSq++; else if (c === ']') cSq++;
  }
  let out = s;
  if (open > close) { out += '}'.repeat(open - close); notes.push('Added ' + (open - close) + ' missing "}".'); }
  else if (close > open) { out = '{'.repeat(close - open) + out; notes.push('Added ' + (close - open) + ' missing "{".'); }
  if (oSq > cSq) { out += ']'.repeat(oSq - cSq); notes.push('Added ' + (oSq - cSq) + ' missing "]".'); }
  else if (cSq > oSq) { out = '['.repeat(cSq - oSq) + out; notes.push('Added ' + (cSq - oSq) + ' missing "[".'); }
  return out;
}

function parseDocument(text, format, autoFix) {
  if (!format) format = 'json';
  if (format !== 'json' && format !== 'yaml') {
    throw makeErr('invalid_format', 'Format must be "json" or "yaml".');
  }
  if (format === 'json') {
    try { return { value: parseJsonStrict(text), repairs: [] }; }
    catch (e) {
      if (!autoFix) throw makeErr('invalid_json', e.message);
      const fx = autoFixJson(text);
      try { return { value: parseJsonStrict(fx.fixed), repairs: fx.notes }; }
      catch (e2) { throw makeErr('invalid_json', e2.message, { repairs_attempted: fx.notes }); }
    }
  }
  try {
    const v = yaml.load(text, { schema: yaml.JSON_SCHEMA });
    if (v === undefined) throw new Error('Empty or invalid YAML.');
    return { value: v, repairs: [] };
  } catch (e) {
    throw makeErr('invalid_json', 'YAML parse error: ' + e.message);
  }
}

function makeErr(code, message, details) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  err.httpStatus = code === 'invalid_format' ? 400 : code === 'payload_too_large' ? 413 : 400;
  return err;
}

const TypePatterns = {
  datetime: /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/,
  date:     /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}-\d{1,2}-\d{4})$/,
  time:     /^\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:\s?[AaPp][Mm])?$/,
  email:    /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/,
  url:      /^(?:https?|ftp|file|data):\/\/[^\s]+$/,
  uuid:     /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  ipv4:     /^(?:\d{1,3}\.){3}\d{1,3}$/,
  phone:    /^\+?[\d\s().-]{7,20}$/,
};

function inferType(v) {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 'numeric';
    return Number.isInteger(v) ? 'integer' : 'float';
  }
  if (typeof v === 'string') {
    if (v === '') return 'empty';
    if (TypePatterns.datetime.test(v)) return 'datetime';
    if (TypePatterns.date.test(v)) return 'date';
    if (TypePatterns.time.test(v)) return 'time';
    if (TypePatterns.email.test(v)) return 'email';
    if (TypePatterns.url.test(v)) return 'url';
    if (TypePatterns.uuid.test(v)) return 'uuid';
    if (TypePatterns.ipv4.test(v)) return 'ipv4';
    if (TypePatterns.phone.test(v)) {
      const d = (v.match(/\d/g) || []).length;
      if (d >= 7 && d <= 15) return 'phone';
    }
    return 'string';
  }
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'object';
  return 'string';
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function collectExplain(value, path, out, depth, maxDepth) {
  if (depth > maxDepth) return;
  const t = typeOf(value);
  if (t === 'object') {
    Object.keys(value).forEach(k => {
      const v = value[k];
      const childPath = path + '.' + k;
      const entry = { path: childPath, type: typeOf(v) };
      if (Array.isArray(v)) { entry.length = v.length; if (v.length) entry.example = v[0]; }
      else if (v && typeof v === 'object') { entry.length = Object.keys(v).length; }
      else { entry.example = v; }
      out.push(entry);
      collectExplain(v, childPath, out, depth + 1, maxDepth);
    });
  } else if (t === 'array' && value.length > 0) {
    const first = value[0];
    const childPath = path + '[0]';
    const entry = { path: childPath, type: typeOf(first) };
    if (Array.isArray(first)) entry.length = first.length;
    else if (first && typeof first === 'object') entry.length = Object.keys(first).length;
    else entry.example = first;
    out.push(entry);
    collectExplain(first, childPath, out, depth + 1, maxDepth);
  }
}

function parseQuery(input) {
  let q = input.trim();
  if (!q) return { ok: true, tokens: [] };
  if (q.startsWith('$')) q = q.slice(1);
  if (q.startsWith('.')) q = q.slice(1);
  const tokens = [];
  let i = 0;
  while (i < q.length) {
    const c = q[i];
    if (c === '.') { i++; continue; }
    if (c === '[') {
      const end = q.indexOf(']', i);
      if (end === -1) return { ok: false, error: 'Unmatched [ at position ' + i };
      const inner = q.slice(i + 1, end).trim();
      if (inner === '*') tokens.push({ type: 'wildcard' });
      else if (/^-?\d+$/.test(inner)) tokens.push({ type: 'index', value: parseInt(inner, 10) });
      else if (/^['"].*['"]$/.test(inner)) tokens.push({ type: 'key', value: inner.slice(1, -1) });
      else return { ok: false, error: 'Invalid bracket "' + inner + '"' };
      i = end + 1;
      continue;
    }
    let j = i;
    while (j < q.length && q[j] !== '.' && q[j] !== '[') j++;
    const key = q.slice(i, j);
    if (key) tokens.push({ type: 'key', value: key });
    i = j;
  }
  return { ok: true, tokens };
}

function evaluateQuery(data, tokens) {
  let current = [{ path: '$', value: data }];
  for (const tok of tokens) {
    const next = [];
    for (const node of current) {
      const v = node.value;
      if (v === null || v === undefined) continue;
      if (tok.type === 'key') {
        if (typeof v === 'object' && !Array.isArray(v) && tok.value in v) {
          next.push({ path: node.path + '.' + tok.value, value: v[tok.value] });
        }
      } else if (tok.type === 'index') {
        if (Array.isArray(v)) {
          const idx = tok.value < 0 ? v.length + tok.value : tok.value;
          if (idx >= 0 && idx < v.length) next.push({ path: node.path + '[' + idx + ']', value: v[idx] });
        }
      } else if (tok.type === 'wildcard') {
        if (Array.isArray(v)) v.forEach((item, idx) => next.push({ path: node.path + '[' + idx + ']', value: item }));
        else if (v && typeof v === 'object') Object.keys(v).forEach(k => next.push({ path: node.path + '.' + k, value: v[k] }));
      }
    }
    current = next;
    if (current.length === 0) break;
  }
  return current;
}

function inferSchema(value) {
  if (value === null) return { type: 'null' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (typeof value === 'number') return Number.isInteger(value) ? { type: 'integer' } : { type: 'number' };
  if (typeof value === 'string') {
    const fmt = detectStringFormat(value);
    const out = { type: 'string' };
    if (fmt) out.format = fmt;
    return out;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return { type: 'array', items: {} };
    const itemSchemas = value.map(inferSchema);
    return { type: 'array', items: mergeSchemas(itemSchemas) };
  }
  if (typeof value === 'object') {
    const out = { type: 'object', properties: {}, required: [] };
    for (const k of Object.keys(value)) {
      out.properties[k] = inferSchema(value[k]);
      out.required.push(k);
    }
    if (!out.required.length) delete out.required;
    return out;
  }
  return {};
}

function detectStringFormat(s) {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(s)) return 'date-time';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'date';
  if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s)) return 'email';
  if (/^(?:https?|ftp):\/\/[^\s]+$/.test(s)) return 'uri';
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s)) return 'uuid';
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(s)) return 'ipv4';
  return null;
}

function mergeSchemas(schemas) {
  if (schemas.length === 0) return {};
  if (schemas.length === 1) return schemas[0];
  const types = [...new Set(schemas.map(s => s.type).filter(Boolean))];
  if (types.length === 1 && types[0] === 'object') {
    const props = {};
    const reqCounts = {};
    schemas.forEach(s => {
      if (s.properties) Object.keys(s.properties).forEach(k => { if (!props[k]) props[k] = []; props[k].push(s.properties[k]); });
      if (s.required) s.required.forEach(k => { reqCounts[k] = (reqCounts[k] || 0) + 1; });
    });
    const merged = { type: 'object', properties: {} };
    for (const k of Object.keys(props)) merged.properties[k] = mergeSchemas(props[k]);
    const req = Object.keys(reqCounts).filter(k => reqCounts[k] === schemas.length);
    if (req.length) merged.required = req;
    return merged;
  }
  if (types.length === 1 && types[0] === 'array') {
    const items = schemas.map(s => s.items).filter(Boolean);
    return { type: 'array', items: mergeSchemas(items) };
  }
  if (types.length === 1) {
    const merged = { type: types[0] };
    const formats = [...new Set(schemas.map(s => s.format).filter(Boolean))];
    if (formats.length === 1) merged.format = formats[0];
    return merged;
  }
  return { type: types };
}

function jsType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every(k => deepEqual(a[k], b[k]));
}

function validateAgainstSchema(value, schema, path) {
  path = path || '$';
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = jsType(value);
    const matches = types.some(t => t === actual || (t === 'number' && actual === 'integer'));
    if (!matches) { errors.push({ path, message: 'Expected type ' + types.join(' or ') + ', got ' + actual }); return errors; }
  }
  if (schema.enum) {
    if (!schema.enum.some(e => deepEqual(e, value))) errors.push({ path, message: 'Value not in enum: ' + JSON.stringify(schema.enum) });
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push({ path, message: 'String shorter than ' + schema.minLength });
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push({ path, message: 'String longer than ' + schema.maxLength });
    if (schema.pattern) {
      try { if (!new RegExp(schema.pattern).test(value)) errors.push({ path, message: 'String does not match pattern: ' + schema.pattern }); } catch (_) {}
    }
    if (schema.format) {
      const formats = {
        'date-time': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/,
        'date': /^\d{4}-\d{2}-\d{2}$/,
        'email': /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/,
        'uri': /^(?:https?|ftp|file|data):\/\/[^\s]+$/,
        'uuid': /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
        'ipv4': /^(?:\d{1,3}\.){3}\d{1,3}$/,
      };
      if (formats[schema.format] && !formats[schema.format].test(value)) errors.push({ path, message: 'String does not match format: ' + schema.format });
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path, message: 'Below minimum ' + schema.minimum });
    if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path, message: 'Above maximum ' + schema.maximum });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push({ path, message: 'Fewer than ' + schema.minItems + ' items' });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push({ path, message: 'More than ' + schema.maxItems + ' items' });
    if (schema.items) {
      value.forEach((item, i) => { errors.push(...validateAgainstSchema(item, schema.items, path + '[' + i + ']')); });
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    if (schema.required) {
      for (const k of schema.required) if (!(k in value)) errors.push({ path: path + '.' + k, message: 'Required property missing' });
    }
    if (schema.properties) {
      for (const k of Object.keys(value)) if (k in schema.properties) errors.push(...validateAgainstSchema(value[k], schema.properties[k], path + '.' + k));
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const k of Object.keys(value)) if (!(k in schema.properties)) errors.push({ path: path + '.' + k, message: 'Additional property not allowed' });
    }
  }
  return errors;
}

const FAKE_FIRST_NAMES = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry', 'Iris', 'Jack', 'Kate', 'Liam', 'Maya', 'Noah', 'Olivia'];
const FAKE_LAST_NAMES = ['Smith', 'Johnson', 'Chen', 'Williams', 'Brown', 'Muller', 'Garcia', 'Rodriguez', 'Anderson', 'Lee', 'Kim', 'Wang', 'Patel'];
const FAKE_CITIES = ['Paris', 'Tokyo', 'Berlin', 'London', 'Sydney', 'New York', 'Toronto', 'Mumbai', 'Cairo', 'Lima'];
const FAKE_DOMAINS = ['example.com', 'acme.io', 'mailcorp.net', 'test.org'];

function rand(n) { return Math.floor(Math.random() * n); }
function pick(arr) { return arr[rand(arr.length)]; }
function randInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

function generateMockFromSchema(schema, keyHint) {
  if (!schema || typeof schema !== 'object') return null;
  if (schema.enum && schema.enum.length) return pick(schema.enum);
  if (schema.const !== undefined) return schema.const;
  const types = Array.isArray(schema.type) ? schema.type : (schema.type ? [schema.type] : []);
  const type = types[0] || (schema.properties ? 'object' : schema.items ? 'array' : 'string');

  if (type === 'null') return null;
  if (type === 'boolean') return Math.random() < 0.5;
  if (type === 'integer') {
    const min = schema.minimum !== undefined ? schema.minimum : 1;
    const max = schema.maximum !== undefined ? schema.maximum : (min + 99);
    return randInt(Math.ceil(min), Math.floor(max));
  }
  if (type === 'number') {
    const min = schema.minimum !== undefined ? schema.minimum : 0;
    const max = schema.maximum !== undefined ? schema.maximum : (min + 100);
    return +(min + Math.random() * (max - min)).toFixed(2);
  }
  if (type === 'string') {
    if (schema.format) return mockByFormat(schema.format);
    if (keyHint) return mockByKey(keyHint);
    const len = randInt(schema.minLength || 5, Math.max(schema.minLength || 5, schema.maxLength || 12));
    return randomWord(len);
  }
  if (type === 'array') {
    const count = randInt(schema.minItems || 1, Math.max(schema.minItems || 1, schema.maxItems || 3));
    const out = [];
    for (let i = 0; i < count; i++) out.push(generateMockFromSchema(schema.items || {}));
    return out;
  }
  if (type === 'object') {
    const out = {};
    const props = schema.properties || {};
    const required = schema.required || Object.keys(props);
    for (const k of Object.keys(props)) {
      if (required.includes(k) || Math.random() < 0.7) out[k] = generateMockFromSchema(props[k], k);
    }
    return out;
  }
  return null;
}

function mockByFormat(fmt) {
  switch (fmt) {
    case 'date-time': return new Date(Date.now() - rand(365 * 86400000)).toISOString();
    case 'date':      return new Date(Date.now() - rand(365 * 86400000)).toISOString().split('T')[0];
    case 'email':     return pick(FAKE_FIRST_NAMES).toLowerCase() + '.' + pick(FAKE_LAST_NAMES).toLowerCase() + '@' + pick(FAKE_DOMAINS);
    case 'uri':       return 'https://' + pick(FAKE_DOMAINS) + '/' + randomWord(6).toLowerCase();
    case 'uuid':      return ('xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx').replace(/[xy]/g, c => { const r = rand(16); return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); });
    case 'ipv4':      return randInt(1, 255) + '.' + randInt(0, 255) + '.' + randInt(0, 255) + '.' + randInt(1, 254);
    default:          return randomWord(8);
  }
}

function mockByKey(key) {
  const k = key.toLowerCase();
  if (/email/.test(k)) return mockByFormat('email');
  if (/url|website/.test(k)) return mockByFormat('uri');
  if (/uuid|guid/.test(k)) return mockByFormat('uuid');
  if (/ip(_?addr)?/.test(k)) return mockByFormat('ipv4');
  if (/first.?name|given.?name/.test(k)) return pick(FAKE_FIRST_NAMES);
  if (/last.?name|surname/.test(k)) return pick(FAKE_LAST_NAMES);
  if (/name/.test(k)) return pick(FAKE_FIRST_NAMES) + ' ' + pick(FAKE_LAST_NAMES);
  if (/city|town/.test(k)) return pick(FAKE_CITIES);
  if (/phone|tel/.test(k)) return '+1 ' + randInt(200, 999) + '-' + randInt(100, 999) + '-' + randInt(1000, 9999);
  if (/date|_at$|_on$/.test(k)) return mockByFormat('date');
  if (/status|state/.test(k)) return pick(['active', 'pending', 'archived']);
  return randomWord(randInt(5, 10));
}

function randomWord(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let w = '';
  for (let i = 0; i < len; i++) w += chars[rand(chars.length)];
  return w;
}

function computeDiff(a, b, path, opts) {
  path = path || '$';
  opts = opts || {};
  const out = { added: [], removed: [], changed: [], unchanged: 0 };

  if (deepEqual(a, b)) { out.unchanged++; return out; }

  if (jsType(a) !== jsType(b) || (typeof a !== 'object' || a === null) || (typeof b !== 'object' || b === null)) {
    out.changed.push({ path, oldValue: a, newValue: b });
    return out;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (opts.ignoreOrder) {
      const usedB = new Set();
      a.forEach((aItem, i) => {
        let matched = false;
        for (let j = 0; j < b.length; j++) {
          if (!usedB.has(j) && deepEqual(aItem, b[j])) { usedB.add(j); matched = true; break; }
        }
        if (!matched) out.removed.push({ path: path + '[' + i + ']', value: aItem });
      });
      b.forEach((bItem, j) => { if (!usedB.has(j)) out.added.push({ path: path + '[' + j + ']', value: bItem }); });
    } else {
      const max = Math.max(a.length, b.length);
      for (let i = 0; i < max; i++) {
        const subPath = path + '[' + i + ']';
        if (i >= a.length) out.added.push({ path: subPath, value: b[i] });
        else if (i >= b.length) out.removed.push({ path: subPath, value: a[i] });
        else { const sub = computeDiff(a[i], b[i], subPath, opts); mergeDiff(out, sub); }
      }
    }
    return out;
  }

  for (const k of Object.keys(a)) {
    const subPath = path + '.' + k;
    if (!(k in b)) out.removed.push({ path: subPath, value: a[k] });
    else { const sub = computeDiff(a[k], b[k], subPath, opts); mergeDiff(out, sub); }
  }
  for (const k of Object.keys(b)) {
    if (!(k in a)) out.added.push({ path: path + '.' + k, value: b[k] });
  }
  return out;
}

function mergeDiff(target, sub) {
  target.added.push(...sub.added);
  target.removed.push(...sub.removed);
  target.changed.push(...sub.changed);
  target.unchanged += sub.unchanged;
}

module.exports = {
  respond,
  error,
  handleOptions,
  readBody,
  parseDocument,
  yaml,
  inferType,
  collectExplain,
  parseQuery,
  evaluateQuery,
  inferSchema,
  validateAgainstSchema,
  generateMockFromSchema,
  computeDiff,
  MAX_BODY_BYTES,
};

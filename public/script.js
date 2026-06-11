/* ============================================================
   EARLY SECURITY GATE — runs before anything else.
   Guarantees the Contact History tab is hidden unless the
   developer has a valid (recent) unlock in this browser session.
   Unlock expires after 24 hours regardless of session state.
============================================================ */
(function enforceContactHistoryGate() {
  try {
    const raw = sessionStorage.getItem('jsonpi.devUnlocked');
    let valid = false;
    if (raw) {
      const ts = parseInt(raw, 10);
      // Accept either valid timestamp within TTL, or treat old '1' values as expired.
      if (Number.isFinite(ts) && (Date.now() - ts < 24 * 60 * 60 * 1000)) {
        valid = true;
      } else {
        sessionStorage.removeItem('jsonpi.devUnlocked');
      }
    }
    const tab = document.querySelector('.tab[data-tab="contact-history"]');
    if (tab) {
      if (valid) tab.removeAttribute('hidden');
      else tab.setAttribute('hidden', '');
    }
  } catch (_) {
    /* If storage is blocked, the tab stays hidden (the default) */
  }
})();

const State = {
  parsed: null,            
  parsedFromData: null,    
  parsedForExplain: null,  
  activeFormat: 'json',    
};

(function setupXmlLib() {
  if (typeof window.xml2js === 'function' && typeof window.js2xml === 'function') {
    window.XmlLib = { xml2js: window.xml2js, js2xml: window.js2xml };
    return;
  }
  
  if (window.XmlLib && typeof window.XmlLib.xml2js === 'function') {
    return;
  }
  if (window['xml-js'] && typeof window['xml-js'].xml2js === 'function') {
    window.XmlLib = window['xml-js'];
    return;
  }
  
  window.XmlLib = null;
})();

const Format = {
  json: {
    label: 'JSON',
    ext: 'json',
    mime: 'application/json',
    placeholder: '{\n  "name": "alice",\n  "active": true,\n  "scores": [12, 7, 99]\n}',
    parseStrict(text) {
      return JSON.parse(text);
    },
    parse(text) {
      
      try { return { value: JSON.parse(text), notes: [] }; }
      catch (e) {
        const fx = autoFixJson(text);
        const v = JSON.parse(fx.fixed);
        return { value: v, notes: fx.notes };
      }
    },
    stringify(obj) {
      return JSON.stringify(obj, null, 2);
    },
    minify(obj) { return JSON.stringify(obj); },
    looksLike(text) {
      const t = text.trim();
      if (!t) return false;
      const f = t[0];
      return f === '{' || f === '[' || f === '"' || /^-?\d/.test(t) || /^(true|false|null)\b/.test(t);
    },
    describeError(text, err) {
      return describeParseError(text, err);
    },
    autoFix(text) {
      return autoFixJson(text);
    },
  },
  yaml: {
    label: 'YAML',
    ext: 'yaml',
    mime: 'text/yaml',
    placeholder: 'name: alice\nactive: true\nscores:\n  - 12\n  - 7\n  - 99\n',
    parseStrict(text) {
      if (!window.jsyaml) throw new Error('YAML library failed to load.');
      
      
      const v = jsyaml.load(text, { schema: jsyaml.JSON_SCHEMA });
      if (v === undefined) throw new Error('Empty or invalid YAML document.');
      return v;
    },
    parse(text) {
      try { return { value: this.parseStrict(text), notes: [] }; }
      catch (e) {
        const fx = autoFixYaml(text);
        try {
          const v = this.parseStrict(fx.fixed);
          return { value: v, notes: fx.notes };
        } catch (e2) {
          
          const err = new Error(e2.message);
          err.notes = fx.notes;
          throw err;
        }
      }
    },
    stringify(obj) {
      if (!window.jsyaml) throw new Error('YAML library failed to load.');
      return jsyaml.dump(obj, { indent: 2, lineWidth: 120, noRefs: true });
    },
    minify(obj) {
      return jsyaml.dump(obj, { indent: 1, flowLevel: 0, noRefs: true });
    },
    looksLike(text) {
      const t = text.trim();
      if (!t) return false;
      
      if (/^[\w\-.]+:\s/m.test(t) || /^-\s/m.test(t) || /^---\s*$/m.test(t)) return true;
      
      return false;
    },
    describeError(text, err) {
      return err.message || String(err);
    },
    autoFix(text) {
      return autoFixYaml(text);
    },
  },
  xml: {
    label: 'XML',
    ext: 'xml',
    mime: 'application/xml',
    placeholder: '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  <name>alice</name>\n  <active>true</active>\n  <scores>\n    <item>12</item>\n    <item>7</item>\n    <item>99</item>\n  </scores>\n</root>',
    parseStrict(text) {
      if (!window.XmlLib) throw new Error('XML library failed to load.');
      
      
      const raw = XmlLib.xml2js(text, {
        compact: true,
        ignoreDeclaration: false,
        ignoreComment: true,
        nativeType: true,
        alwaysArray: false,
      });
      return xmlCompactToNice(raw);
    },
    parse(text) {
      try { return { value: this.parseStrict(text), notes: [] }; }
      catch (e) {
        const fx = autoFixXml(text);
        try {
          const v = this.parseStrict(fx.fixed);
          return { value: v, notes: fx.notes };
        } catch (e2) {
          const err = new Error(e2.message);
          err.notes = fx.notes;
          throw err;
        }
      }
    },
    stringify(obj) {
      if (!window.XmlLib) throw new Error('XML library failed to load.');
      
      
      let toSerialize = obj;
      if (obj === null || typeof obj !== 'object' || Array.isArray(obj) || Object.keys(obj).length !== 1) {
        toSerialize = { root: obj };
      }
      const compact = niceToXmlCompact(toSerialize);
      const xml = XmlLib.js2xml(compact, { compact: true, spaces: 2 });
      
      if (!/^\s*<\?xml/.test(xml)) {
        return '<?xml version="1.0" encoding="UTF-8"?>\n' + xml;
      }
      return xml;
    },
    minify(obj) {
      let toSerialize = obj;
      if (obj === null || typeof obj !== 'object' || Array.isArray(obj) || Object.keys(obj).length !== 1) {
        toSerialize = { root: obj };
      }
      const compact = niceToXmlCompact(toSerialize);
      return XmlLib.js2xml(compact, { compact: true, spaces: 0 });
    },
    looksLike(text) {
      const t = text.trim();
      if (!t) return false;
      return t.startsWith('<');
    },
    describeError(text, err) {
      return err.message || String(err);
    },
    autoFix(text) {
      return autoFixXml(text);
    },
  },
};

function xmlCompactToNice(node) {
  if (node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(xmlCompactToNice);
  const keys = Object.keys(node);
  
  if (keys.length === 1 && keys[0] === '_text') {
    return node._text;
  }
  const out = {};
  for (const k of keys) {
    let newKey = k;
    if (k === '_text') newKey = '#text';
    else if (k === '_attributes') newKey = '@attributes';
    else if (k === '_declaration') newKey = '?xml';
    else if (k === '_cdata') newKey = '#cdata';
    else if (k === '_comment') newKey = '#comment';
    out[newKey] = xmlCompactToNice(node[k]);
  }
  return out;
}
function niceToXmlCompact(node) {
  if (node === null || typeof node === 'undefined') return { _text: '' };
  if (typeof node !== 'object') {
    
    return { _text: String(node) };
  }
  if (Array.isArray(node)) return node.map(niceToXmlCompact);
  const out = {};
  for (const k of Object.keys(node)) {
    let newKey = k;
    if (k === '#text') newKey = '_text';
    else if (k === '@attributes') newKey = '_attributes';
    else if (k === '?xml') newKey = '_declaration';
    else if (k === '#cdata') newKey = '_cdata';
    else if (k === '#comment') newKey = '_comment';
    const v = node[k];
    
    if (v === null || v === undefined) {
      out[newKey] = { _text: '' };
    } else if (typeof v !== 'object') {
      out[newKey] = { _text: String(v) };
    } else {
      out[newKey] = niceToXmlCompact(v);
    }
  }
  return out;
}

function fmt() { return Format[State.activeFormat]; }

document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('panel-' + t.dataset.tab).classList.add('active');
  });
});

function updateFormatLabels() {
  const F = fmt();
  
  document.getElementById('subtitle-format').textContent = F.label;
  
  document.querySelectorAll('.tab-format').forEach(el => el.textContent = F.label);

  // Parse / Auto-fix buttons reflect active format
  const btnParse = document.getElementById('btn-parse');
  if (btnParse) btnParse.textContent = 'Parse ' + F.label;
  const btnAutofix = document.getElementById('btn-autofix');
  if (btnAutofix) btnAutofix.innerHTML = 'Auto-fix &amp; Parse';
  
  if (jsonInput) jsonInput.placeholder = F.placeholder;
  if (explainInput) explainInput.placeholder = 'Paste ' + F.label + ' here to get a key-by-key explanation of its structure, types, and example values.';

  
  rebuildConvertOptions();
}

document.getElementById('active-format').addEventListener('change', e => {
  if (e.target.value === 'xml') {
    
    e.target.value = State.activeFormat;
    showStatus('status-json', 'warn', 'XML is under construction.', 'XML support is temporarily disabled. Please use JSON or YAML for now.');
    setTimeout(() => hideStatus('status-json'), 3000);
    return;
  }
  State.activeFormat = e.target.value;
  updateFormatLabels();
  
  State.parsed = null;
  document.getElementById('json-output').innerHTML = '<div class="output-empty">Parsed output will appear here.</div>';
  hideStatus('status-json');
});

function showStatus(elId, type, title, detail) {
  const el = document.getElementById(elId);
  el.className = 'status show ' + type;
  el.innerHTML =
    '<div class="status-title">' + escapeHtml(title) + '</div>' +
    (detail ? '<div class="status-detail">' + escapeHtml(detail) + '</div>' : '');
}
function hideStatus(elId) {
  document.getElementById(elId).className = 'status';
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function tryStrictParse(text) {
  try { return { ok: true, value: JSON.parse(text) }; }
  catch (e) { return { ok: false, error: e }; }
}

function autoFixJson(text) {
  const notes = [];
  let s = text.trim();

  if (!s) throw new Error('Input is empty.');

  
  if (s.charCodeAt(0) === 0xFEFF) {
    s = s.slice(1);
    notes.push('Removed byte-order mark (BOM).');
  }

  
  const before = s;
  s = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  if (s !== before) notes.push('Replaced smart/curly quotes with straight quotes.');

  
  s = stripCommentsAwareOfStrings(s, notes);

  
  s = replaceOutsideStrings(s, /\bTrue\b/g, 'true', notes, 'Converted Python True → true.');
  s = replaceOutsideStrings(s, /\bFalse\b/g, 'false', notes, 'Converted Python False → false.');
  s = replaceOutsideStrings(s, /\bNone\b/g, 'null', notes, 'Converted Python None → null.');
  s = replaceOutsideStrings(s, /\bNaN\b/g, 'null', notes, 'Converted NaN → null.');
  s = replaceOutsideStrings(s, /\bundefined\b/g, 'null', notes, 'Converted undefined → null.');

  
  s = quoteUnquotedKeys(s, notes);

  
  s = singleToDoubleQuotedStrings(s, notes);

  
  s = insertMissingCommas(s, notes);

  
  const beforeTrailing = s;
  s = s.replace(/,(\s*[}\]])/g, '$1');
  if (s !== beforeTrailing) notes.push('Removed trailing commas.');

  
  s = balanceBrackets(s, notes);

  return { fixed: s, notes };
}

function insertMissingCommas(s, notes) {
  let out = '';
  let i = 0;
  let inStr = null;
  const stack = []; 
  let inserted = 0;
  let lastNonWsCharOutsideStr = '';

  function startsValue(ch) {
    return ch === '"' || ch === '{' || ch === '[' || ch === '-' || /[0-9A-Za-z_]/.test(ch);
  }

  function maybeInsertComma(nextChar) {
    if (!stack.length) return;
    const last = lastNonWsCharOutsideStr;
    if (!last) return;
    if (last === ',' || last === ':' || last === '{' || last === '[') return;
    const lastIsEnd = (last === '"' || last === '}' || last === ']' || /[A-Za-z0-9_]/.test(last));
    if (!lastIsEnd) return;
    if (!startsValue(nextChar)) return;
    out += ',';
    inserted++;
  }

  while (i < s.length) {
    const c = s[i];

    if (inStr) {
      out += c;
      if (c === '\\' && i + 1 < s.length) { out += s[i + 1]; i += 2; continue; }
      if (c === inStr) {
        inStr = null;
        lastNonWsCharOutsideStr = '"';
      }
      i++;
      continue;
    }

    if (c === '"') {
      maybeInsertComma(c);
      inStr = '"';
      out += c;
      lastNonWsCharOutsideStr = ''; 
      i++;
      continue;
    }

    if (/\s/.test(c)) {
      out += c;
      i++;
      continue;
    }

    if (c === '{' || c === '[') {
      maybeInsertComma(c);
      stack.push(c);
      out += c;
      lastNonWsCharOutsideStr = c;
      i++;
      continue;
    }

    if (c === '}' || c === ']') {
      stack.pop();
      out += c;
      lastNonWsCharOutsideStr = c;
      i++;
      continue;
    }

    if (c === ',' || c === ':') {
      out += c;
      lastNonWsCharOutsideStr = c;
      i++;
      continue;
    }

    
    
    if (/[A-Za-z0-9_+\-.]/.test(c)) {
      maybeInsertComma(c);
      let tok = '';
      while (i < s.length && /[A-Za-z0-9_+\-.eE]/.test(s[i])) {
        tok += s[i];
        i++;
      }
      out += tok;
      lastNonWsCharOutsideStr = tok[tok.length - 1];
      continue;
    }

    
    out += c;
    lastNonWsCharOutsideStr = c;
    i++;
  }

  if (inserted > 0) notes.push('Inserted ' + inserted + ' missing comma(s) between values.');
  return out;
}

function needsCommaBefore(lastChar, nextChar, container) {
  
  if (!lastChar) return false;
  if (lastChar === ',' || lastChar === ':' || lastChar === '{' || lastChar === '[') return false;
  const lastIsEnd = (lastChar === '"' || lastChar === '}' || lastChar === ']' || /[A-Za-z0-9_]/.test(lastChar));
  if (!lastIsEnd) return false;
  const nextIsStart = (nextChar === '"' || nextChar === '{' || nextChar === '[' || nextChar === '-' || /[0-9A-Za-z_]/.test(nextChar));
  return nextIsStart;
}

function walkOutsideStrings(s, callback) {
  let out = '';
  let i = 0;
  let inStr = null; 
  while (i < s.length) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (c === '\\' && i + 1 < s.length) { out += s[i + 1]; i += 2; continue; }
      if (c === inStr) inStr = null;
      i++;
    } else {
      if (c === '"' || c === "'") { inStr = c; out += c; i++; continue; }
      const consumed = callback(s, i);
      if (consumed) {
        out += consumed.append;
        i += consumed.skip;
      } else {
        out += c;
        i++;
      }
    }
  }
  return out;
}

function stripCommentsAwareOfStrings(s, notes) {
  let removed = false;
  const result = walkOutsideStrings(s, (str, i) => {
    if (str[i] === '/' && str[i + 1] === '/') {
      
      let j = i + 2;
      while (j < str.length && str[j] !== '\n') j++;
      removed = true;
      return { append: '', skip: j - i };
    }
    if (str[i] === '/' && str[i + 1] === '*') {
      let j = i + 2;
      while (j < str.length - 1 && !(str[j] === '*' && str[j + 1] === '/')) j++;
      removed = true;
      return { append: '', skip: Math.min(str.length, j + 2) - i };
    }
    return null;
  });
  if (removed) notes.push('Removed // and /* */ comments.');
  return result;
}

function replaceOutsideStrings(s, regex, replacement, notes, msg) {
  let changed = false;
  let inStr = null;
  let i = 0;
  let out = '';
  let buffer = '';
  
  const chunks = [];
  while (i < s.length) {
    const c = s[i];
    if (inStr) {
      buffer += c;
      if (c === '\\' && i + 1 < s.length) { buffer += s[i + 1]; i += 2; continue; }
      if (c === inStr) { chunks.push({ str: true, text: buffer }); buffer = ''; inStr = null; }
      i++;
    } else {
      if (c === '"' || c === "'") {
        if (buffer) chunks.push({ str: false, text: buffer });
        buffer = c;
        inStr = c;
        i++;
      } else {
        buffer += c;
        i++;
      }
    }
  }
  if (buffer) chunks.push({ str: inStr != null, text: buffer });

  out = chunks.map(ch => {
    if (ch.str) return ch.text;
    const replaced = ch.text.replace(regex, replacement);
    if (replaced !== ch.text) changed = true;
    return replaced;
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
  if (changed) notes.push('Quoted unquoted keys (e.g. {name: …} → {"name": …}).');
  return result;
}

function singleToDoubleQuotedStrings(s, notes) {
  
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
      i++;
    } else if (inStr === "'") {
      
      if (c === '\\' && i + 1 < s.length) {
        if (s[i + 1] === "'") { out += "'"; i += 2; continue; }
        out += c + s[i + 1]; i += 2; continue;
      }
      if (c === "'") { out += '"'; inStr = null; i++; continue; }
      if (c === '"') { out += '\\"'; i++; continue; }
      out += c; i++;
    } else {
      if (c === '"') { inStr = '"'; out += c; i++; }
      else if (c === "'") { inStr = "'"; out += '"'; i++; changed = true; }
      else { out += c; i++; }
    }
  }
  if (changed) notes.push("Converted single-quoted strings to double-quoted strings.");
  return out;
}

function balanceBrackets(s, notes) {
  
  let inStr = null;
  let open = 0, close = 0, openSq = 0, closeSq = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '{') open++;
    else if (c === '}') close++;
    else if (c === '[') openSq++;
    else if (c === ']') closeSq++;
  }
  let out = s;
  if (open > close) {
    out += '}'.repeat(open - close);
    notes.push('Added ' + (open - close) + ' missing closing brace(s) "}".');
  } else if (close > open) {
    out = '{'.repeat(close - open) + out;
    notes.push('Added ' + (close - open) + ' missing opening brace(s) "{".');
  }
  if (openSq > closeSq) {
    out += ']'.repeat(openSq - closeSq);
    notes.push('Added ' + (openSq - closeSq) + ' missing closing bracket(s) "]".');
  } else if (closeSq > openSq) {
    out = '['.repeat(closeSq - openSq) + out;
    notes.push('Added ' + (closeSq - openSq) + ' missing opening bracket(s) "[".');
  }
  return out;
}

function describeParseError(text, err) {
  const msg = err.message || String(err);
  const m = msg.match(/position\s+(\d+)/i);
  if (!m) return msg;
  const pos = parseInt(m[1], 10);
  let line = 1, col = 1;
  for (let i = 0; i < pos && i < text.length; i++) {
    if (text[i] === '\n') { line++; col = 1; } else col++;
  }
  const lines = text.split('\n');
  const ctx = lines[line - 1] || '';
  const pointer = ' '.repeat(Math.max(0, col - 1)) + '↑';
  return msg + '\n\nAt line ' + line + ', column ' + col + ':\n' + ctx + '\n' + pointer;
}

function looksLikeJson(s) {
  const t = s.trim();
  if (!t) return false;
  const first = t[0];
  const last = t[t.length - 1];
  
  if ('{[]}'.indexOf(first) >= 0) return true;
  if (first === '"') return true;
  if (/^-?\d/.test(t)) return true;
  if (/^(true|false|null)\b/.test(t)) return true;
  return false;
}

function autoFixYaml(text) {
  const notes = [];
  let s = text;
  if (s.charCodeAt(0) === 0xFEFF) {
    s = s.slice(1);
    notes.push('Removed byte-order mark (BOM).');
  }
  if (s.indexOf('\r') >= 0) {
    s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    notes.push('Converted Windows/Mac line endings to Unix.');
  }
  const beforeQuotes = s;
  s = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  if (s !== beforeQuotes) notes.push('Replaced smart/curly quotes with straight quotes.');
  if (s.indexOf('\t') >= 0) {
    s = s.replace(/\t/g, '  ');
    notes.push('Replaced tabs with two-space indentation (tabs are illegal in YAML).');
  }
  
  const before = s;
  s = s.split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n');
  if (s !== before) notes.push('Trimmed trailing whitespace from lines.');
  return { fixed: s, notes };
}

function autoFixXml(text) {
  const notes = [];
  let s = text;
  if (s.charCodeAt(0) === 0xFEFF) {
    s = s.slice(1);
    notes.push('Removed byte-order mark (BOM).');
  }
  if (s.indexOf('\r') >= 0) {
    s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    notes.push('Converted Windows/Mac line endings to Unix.');
  }
  const beforeQuotes = s;
  s = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  if (s !== beforeQuotes) notes.push('Replaced smart/curly quotes with straight quotes.');
  
  const beforeAmp = s;
  s = s.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');
  if (s !== beforeAmp) notes.push('Escaped stray "&" characters as "&amp;".');
  return { fixed: s, notes };
}

function renderOutput(data, mode) {
  const out = document.getElementById('json-output');
  const titleEl = document.getElementById('output-title');
  out.innerHTML = '';

  
  renderTypesInto('types-output-1', data);

  if (data === undefined || data === null && mode !== 'raw' && mode !== 'formatted') {
    if (data === null) {
      out.innerHTML = '<div class="output-empty">Parsed value is <code>null</code>.</div>';
      return;
    }
    out.innerHTML = '<div class="output-empty">Nothing to display.</div>';
    return;
  }

  
  const stats = computeStats(data);
  const statsBar = document.createElement('div');
  statsBar.className = 'stats';
  statsBar.innerHTML =
    '<div class="stat"><span class="stat-label">Type:</span><span class="stat-value">' + escapeHtml(stats.rootType) + '</span></div>' +
    '<div class="stat"><span class="stat-label">Keys:</span><span class="stat-value">' + stats.totalKeys + '</span></div>' +
    '<div class="stat"><span class="stat-label">Depth:</span><span class="stat-value">' + stats.maxDepth + '</span></div>' +
    '<div class="stat"><span class="stat-label">Arrays:</span><span class="stat-value">' + stats.arrays + '</span></div>' +
    '<div class="stat"><span class="stat-label">Objects:</span><span class="stat-value">' + stats.objects + '</span></div>' +
    '<div class="stat"><span class="stat-label">Size:</span><span class="stat-value">' + humanBytes(stats.bytes) + '</span></div>';
  out.appendChild(statsBar);

  if (mode === 'tree') {
    titleEl.textContent = 'Interactive Tree';
    out.appendChild(buildTree(data, '$'));
  } else if (mode === 'table') {
    titleEl.textContent = 'Table View';
    out.appendChild(buildTable(data));
  } else if (mode === 'formatted') {
    titleEl.textContent = 'Formatted JSON';
    const pre = document.createElement('pre');
    pre.className = 'json-view';
    pre.innerHTML = syntaxHighlightJson(JSON.stringify(data, null, 2));
    out.appendChild(pre);
  } else {
    titleEl.textContent = 'Raw JSON';
    const pre = document.createElement('pre');
    pre.className = 'json-view';
    pre.textContent = JSON.stringify(data);
    out.appendChild(pre);
  }
}

function computeStats(data) {
  let keys = 0, arrays = 0, objects = 0, maxDepth = 0;
  function walk(v, d) {
    maxDepth = Math.max(maxDepth, d);
    if (Array.isArray(v)) {
      arrays++;
      v.forEach(x => walk(x, d + 1));
    } else if (v && typeof v === 'object') {
      objects++;
      for (const k of Object.keys(v)) {
        keys++;
        walk(v[k], d + 1);
      }
    }
  }
  walk(data, 1);
  const json = JSON.stringify(data);
  return {
    rootType: typeOf(data),
    totalKeys: keys,
    maxDepth,
    arrays,
    objects,
    bytes: new Blob([json]).size
  };
}

function humanBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function syntaxHighlightJson(json) {
  json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return json.replace(
    /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    function (match) {
      let cls = 'json-number';
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'json-key' : 'json-string';
      } else if (/true|false/.test(match)) {
        cls = 'json-boolean';
      } else if (/null/.test(match)) {
        cls = 'json-null';
      }
      return '<span class="' + cls + '">' + match + '</span>';
    }
  );
}

const TypePatterns = {
  
  datetime: /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/,
  
  date: /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}-\d{1,2}-\d{4})$/,
  
  time: /^\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:\s?[AaPp][Mm])?$/,
  
  email: /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/,
  
  url: /^(?:https?|ftp|file|data):\/\/[^\s]+$/,
  
  uuid: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  
  ipv4: /^(?:\d{1,3}\.){3}\d{1,3}$/,
  
  
  phone: /^\+?[\d\s().-]{7,20}$/,
};

function inferType(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'numeric';
    if (Number.isInteger(value)) return 'integer';
    return 'float';
  }
  if (typeof value === 'string') {
    if (value === '') return 'empty';
    if (TypePatterns.datetime.test(value)) return 'datetime';
    if (TypePatterns.date.test(value)) return 'date';
    if (TypePatterns.time.test(value)) return 'time';
    if (TypePatterns.email.test(value)) return 'email';
    if (TypePatterns.url.test(value)) return 'url';
    if (TypePatterns.uuid.test(value)) return 'uuid';
    if (TypePatterns.ipv4.test(value)) return 'ipv4';
    
    if (TypePatterns.phone.test(value)) {
      const digits = (value.match(/\d/g) || []).length;
      if (digits >= 7 && digits <= 15) return 'phone';
    }
    return 'string';
  }
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return 'string';
}

function buildTypeTree(data) {
  const wrap = document.createElement('div');

  
  const counts = {};
  function countTypes(v) {
    const t = inferType(v);
    counts[t] = (counts[t] || 0) + 1;
    if (Array.isArray(v)) v.forEach(countTypes);
    else if (v && typeof v === 'object') Object.values(v).forEach(countTypes);
  }
  countTypes(data);

  
  const summary = document.createElement('div');
  summary.className = 'types-summary';
  const sortedTypes = Object.keys(counts)
    .filter(t => t !== 'object' && t !== 'array')
    .sort((a, b) => counts[b] - counts[a]);
  if (sortedTypes.length) {
    summary.innerHTML = sortedTypes.slice(0, 6).map(t =>
      '<div class="stat"><span class="type-tag ' + t + '">' + t + '</span>' +
      '<span class="stat-value">' + counts[t] + '</span></div>'
    ).join('');
  } else {
    summary.innerHTML = '<div class="stat"><span class="stat-label">No primitive fields detected.</span></div>';
  }
  wrap.appendChild(summary);

  
  const tree = document.createElement('div');
  tree.className = 'types-tree';
  tree.innerHTML = renderTypeNode(data, 0, true);
  wrap.appendChild(tree);

  return wrap;
}

function renderTypeNode(value, indent, isRoot) {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '<div class="types-line">' + pad + '<span class="types-bracket">[ ]</span>  <span class="type-tag array">empty array</span></div>';
    }
    let out = '<div class="types-line">' + pad + '<span class="types-bracket">[</span></div>';
    
    if (value.every(v => v === null || typeof v !== 'object')) {
      const types = new Set(value.map(inferType));
      const typeList = [...types].map(t => '<span class="type-tag ' + t + '">' + t + '</span>').join(' | ');
      out += '<div class="types-line">' + '  '.repeat(indent + 1) +
        typeList + ' <span class="types-bracket">×' + value.length + '</span></div>';
    } else {
      
      out += '<div class="types-line">' + '  '.repeat(indent + 1) +
        '<span class="types-bracket">// ' + value.length + ' item' + (value.length === 1 ? '' : 's') + ' — showing structure of first</span></div>';
      out += renderTypeNode(value[0], indent + 1, false);
    }
    out += '<div class="types-line">' + pad + '<span class="types-bracket">]</span></div>';
    return out;
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return '<div class="types-line">' + pad + '<span class="types-bracket">{ }</span>  <span class="type-tag object">empty object</span></div>';
    }
    let out = '<div class="types-line">' + pad + '<span class="types-bracket">{</span></div>';
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = value[k];
      const childPad = '  '.repeat(indent + 1);
      const isComplex = (Array.isArray(v) || (v && typeof v === 'object'));
      if (isComplex) {
        out += '<div class="types-line">' + childPad +
          '<span class="types-key">"' + escapeHtml(k) + '"</span>: ' +
          (Array.isArray(v)
            ? '<span class="type-tag array">array</span> <span class="types-bracket">(' + v.length + ')</span>'
            : '<span class="type-tag object">object</span> <span class="types-bracket">(' + Object.keys(v).length + ' keys)</span>') +
          '</div>';
        out += renderTypeNode(v, indent + 1, false);
      } else {
        const t = inferType(v);
        out += '<div class="types-line">' + childPad +
          '<span class="types-key">"' + escapeHtml(k) + '"</span>: ' +
          '<span class="type-tag ' + t + '">' + t + '</span>' +
          '</div>';
      }
    }
    out += '<div class="types-line">' + pad + '<span class="types-bracket">}</span></div>';
    return out;
  }

  
  const t = inferType(value);
  return '<div class="types-line">' + pad + '<span class="type-tag ' + t + '">' + t + '</span></div>';
}

function renderTypesInto(targetId, data) {
  const el = document.getElementById(targetId);
  if (!el) return;
  if (data === null || data === undefined) {
    el.innerHTML = '<div class="output-empty">Parse some content first.</div>';
    return;
  }
  el.innerHTML = '';
  el.appendChild(buildTypeTree(data));
}

function typeTreeAsText(value, indent) {
  indent = indent || 0;
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return pad + '[] (empty array)';
    if (value.every(v => v === null || typeof v !== 'object')) {
      const types = [...new Set(value.map(inferType))];
      return pad + '[\n' + '  '.repeat(indent + 1) + '<' + types.join(' | ') + '> × ' + value.length + '\n' + pad + ']';
    }
    return pad + '[ // ' + value.length + ' items\n' + typeTreeAsText(value[0], indent + 1) + '\n' + pad + ']';
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (!keys.length) return pad + '{} (empty object)';
    let out = pad + '{\n';
    for (const k of keys) {
      const v = value[k];
      const childPad = '  '.repeat(indent + 1);
      if (Array.isArray(v) || (v && typeof v === 'object')) {
        out += childPad + '"' + k + '": ' + (Array.isArray(v) ? 'array' : 'object') + '\n';
        out += typeTreeAsText(v, indent + 1) + '\n';
      } else {
        out += childPad + '"' + k + '": <' + inferType(v) + '>\n';
      }
    }
    out += pad + '}';
    return out;
  }
  return pad + '<' + inferType(value) + '>';
}

function buildTree(data, path) {
  const root = document.createElement('div');
  root.className = 'tree';
  root.appendChild(renderTreeNode('$', data, path, 0));
  return root;
}

function renderTreeNode(key, value, path, depth) {
  const node = document.createElement('div');
  node.className = 'tree-node';
  const t = typeOf(value);
  const isContainer = (t === 'object' || t === 'array');

  if (depth > 2) node.classList.add('collapsed');
  if (!isContainer) node.classList.add('leaf');

  const toggle = document.createElement('span');
  toggle.className = 'toggle';
  node.appendChild(toggle);

  const header = document.createElement('span');
  if (key !== null) {
    if (typeof key === 'string' && !/^\d+$/.test(key) && key !== '$') {
      header.innerHTML = '<span class="json-key">"' + escapeHtml(key) + '"</span><span class="json-punct">:</span> ';
    } else if (key === '$') {
      header.innerHTML = '<span class="json-punct">root</span> ';
    } else {
      header.innerHTML = '<span class="json-punct">[' + key + ']</span> ';
    }
  }

  if (isContainer) {
    const count = Array.isArray(value) ? value.length : Object.keys(value).length;
    const open = Array.isArray(value) ? '[' : '{';
    const close = Array.isArray(value) ? ']' : '}';
    header.innerHTML += '<span class="json-punct">' + open + '</span>' +
      '<span class="tree-summary">' + count + ' ' + (Array.isArray(value) ? 'items' : 'keys') + '</span>';

    node.appendChild(header);

    const children = document.createElement('div');
    children.className = 'tree-children';
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        children.appendChild(renderTreeNode(i, v, path + '[' + i + ']', depth + 1));
      });
    } else {
      Object.keys(value).forEach(k => {
        children.appendChild(renderTreeNode(k, value[k], path + '.' + k, depth + 1));
      });
    }
    node.appendChild(children);

    const closer = document.createElement('div');
    closer.style.paddingLeft = '18px';
    closer.innerHTML = '<span class="json-punct">' + close + '</span>';
    node.appendChild(closer);

    toggle.addEventListener('click', () => node.classList.toggle('collapsed'));
  } else {
    header.appendChild(renderLeaf(value));
    node.appendChild(header);
  }

  return node;
}

function renderLeaf(value) {
  const span = document.createElement('span');
  const t = typeOf(value);
  if (t === 'string') {
    span.className = 'json-string';
    span.textContent = '"' + value + '"';
  } else if (t === 'number') {
    span.className = 'json-number';
    span.textContent = value;
  } else if (t === 'boolean') {
    span.className = 'json-boolean';
    span.textContent = value;
  } else if (t === 'null') {
    span.className = 'json-null';
    span.textContent = 'null';
  } else {
    span.textContent = String(value);
  }
  return span;
}

function buildTable(data) {
  const wrap = document.createElement('div');

  
  
  
  
  let tableData = null;
  let tableLabel = 'Root';

  if (Array.isArray(data) && data.length && data.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
    tableData = data;
  } else if (data && typeof data === 'object') {
    
    for (const k of Object.keys(data)) {
      const v = data[k];
      if (Array.isArray(v) && v.length && v.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
        tableData = v;
        tableLabel = k;
        const info = document.createElement('div');
        info.style.cssText = 'font-size:12px;color:var(--text-2);margin-bottom:8px';
        info.innerHTML = 'Showing table for: <code style="font-family:var(--mono)">' + escapeHtml(k) + '</code>. Other keys are available in the tree view.';
        wrap.appendChild(info);
        break;
      }
    }
  }

  if (tableData) {
    wrap.appendChild(renderObjectArrayTable(tableData));
  } else {
    
    const info = document.createElement('div');
    info.style.cssText = 'font-size:12px;color:var(--text-2);margin-bottom:8px';
    info.textContent = 'No array of objects found — showing flattened key/value pairs.';
    wrap.appendChild(info);
    wrap.appendChild(renderFlattenedTable(data));
  }

  return wrap;
}

function renderObjectArrayTable(arr) {
  
  const keys = [];
  const seen = new Set();
  arr.forEach(o => {
    Object.keys(o).forEach(k => {
      if (!seen.has(k)) { seen.add(k); keys.push(k); }
    });
  });

  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const table = document.createElement('table');
  table.className = 'data';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  trh.innerHTML = '<th style="width:40px">#</th>' + keys.map(k => '<th>' + escapeHtml(k) + '</th>').join('');
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  arr.forEach((row, i) => {
    const tr = document.createElement('tr');
    let html = '<td style="color:var(--text-3);font-family:var(--mono)">' + (i + 1) + '</td>';
    keys.forEach(k => {
      html += cellHtml(row[k]);
    });
    tr.innerHTML = html;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function cellHtml(v) {
  if (v === undefined) return '<td class="null">—</td>';
  if (v === null) return '<td class="null">null</td>';
  if (typeof v === 'number') return '<td class="number">' + v + '</td>';
  if (typeof v === 'boolean') return '<td class="boolean">' + v + '</td>';
  if (typeof v === 'string') return '<td>' + escapeHtml(v) + '</td>';
  if (Array.isArray(v) || typeof v === 'object') {
    const s = JSON.stringify(v);
    const display = s.length > 80 ? s.slice(0, 80) + '…' : s;
    return '<td class="nested" title="' + escapeHtml(s) + '">' + escapeHtml(display) + '</td>';
  }
  return '<td>' + escapeHtml(String(v)) + '</td>';
}

function renderFlattenedTable(data) {
  const rows = [];
  flatten(data, '', rows);
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const table = document.createElement('table');
  table.className = 'data';
  table.innerHTML =
    '<thead><tr><th>Path</th><th>Type</th><th>Value</th></tr></thead>' +
    '<tbody>' + rows.map(r =>
      '<tr><td><code style="font-family:var(--mono);font-size:12px">' + escapeHtml(r.path) + '</code></td>' +
      '<td><span class="explain-tag type-' + r.type + '">' + r.type + '</span></td>' +
      cellHtml(r.value) +
      '</tr>'
    ).join('') + '</tbody>';
  wrap.appendChild(table);
  return wrap;
}

function flatten(v, path, rows) {
  const t = typeOf(v);
  if (t === 'object') {
    if (Object.keys(v).length === 0) {
      rows.push({ path: path || '$', type: 'object', value: {} });
      return;
    }
    Object.keys(v).forEach(k => {
      const p = path ? path + '.' + k : k;
      flatten(v[k], p, rows);
    });
  } else if (t === 'array') {
    if (v.length === 0) {
      rows.push({ path: path || '$', type: 'array', value: [] });
      return;
    }
    v.forEach((item, i) => flatten(item, (path || '') + '[' + i + ']', rows));
  } else {
    rows.push({ path: path || '$', type: t, value: v });
  }
}

const jsonInput = document.getElementById('json-input');
const viewMode = document.getElementById('view-mode');

document.getElementById('btn-parse').addEventListener('click', () => doParse(false));
document.getElementById('btn-autofix').addEventListener('click', () => doParse(true));

document.getElementById('btn-format').addEventListener('click', () => {
  if (!State.parsed && !tryStoreParsed()) return;
  jsonInput.value = fmt().stringify(State.parsed);
  showStatus('status-json', 'success', 'Formatted.', '');
});
document.getElementById('btn-minify').addEventListener('click', () => {
  if (!State.parsed && !tryStoreParsed()) return;
  jsonInput.value = fmt().minify(State.parsed);
  showStatus('status-json', 'success', 'Minified.', '');
});

function tryStoreParsed() {
  try {
    State.parsed = fmt().parseStrict(jsonInput.value);
    return true;
  } catch (e) {
    showStatus('status-json', 'error', 'Parse ' + fmt().label + ' first.', e.message);
    return false;
  }
}

viewMode.addEventListener('change', () => {
  if (State.parsed !== null && State.parsed !== undefined) {
    renderOutput(State.parsed, viewMode.value);
  } else {
    
    try {
      State.parsed = fmt().parseStrict(jsonInput.value);
      renderOutput(State.parsed, viewMode.value);
    } catch (_) {}
  }
});

function doParse(useAutoFix) {
  const text = jsonInput.value;
  const F = fmt();
  if (!text.trim()) {
    showStatus('status-json', 'error', 'No input', 'Please paste or upload some ' + F.label + '.');
    return;
  }

  
  try {
    const value = F.parseStrict(text);
    State.parsed = value;
    showStatus('status-json', 'success', 'Parsed successfully.',
      'Root type: ' + typeOf(value) + '. Size: ' + humanBytes(new Blob([text]).size) + '.');
    renderOutput(value, viewMode.value);
    return;
  } catch (strictErr) {
    
    var firstErr = strictErr;
  }

  
  if (!useAutoFix) {
    if (!F.looksLike(text)) {
      const hints = {
        json: 'JSON must start with {, [, ", a number, true, false, or null.',
        yaml: 'YAML usually has lines like "key: value" or items starting with "- ".',
        xml:  'XML must start with "<" — typically an element like <root> or the declaration <?xml ... ?>.',
      };
      showStatus('status-json', 'error',
        'This does not look like ' + F.label + '.',
        hints[State.activeFormat] + ' If your input is broken ' + F.label + ', try "Auto-fix & Parse".');
      document.getElementById('json-output').innerHTML = '<div class="output-empty">Nothing to display.</div>';
      State.parsed = null;
      return;
    }
    showStatus('status-json', 'error', 'Invalid ' + F.label + '.',
      F.describeError(text, firstErr) + '\n\nTip: click "Auto-fix & Parse" to try common repairs.');
    document.getElementById('json-output').innerHTML = '<div class="output-empty">Nothing to display.</div>';
    State.parsed = null;
    return;
  }

  
  let fixResult;
  try { fixResult = F.autoFix(text); }
  catch (e) {
    showStatus('status-json', 'error', 'Auto-fix failed.', e.message);
    return;
  }
  try {
    const value = F.parseStrict(fixResult.fixed);
    State.parsed = value;
    const notes = fixResult.notes.length ? fixResult.notes.map(n => '• ' + n).join('\n') : '(no changes needed)';
    showStatus('status-json', 'warn', 'Auto-fixed and parsed.', 'Applied:\n' + notes);
    jsonInput.value = F.stringify(value);
    renderOutput(value, viewMode.value);
    return;
  } catch (afterErr) {
    if (!F.looksLike(text)) {
      showStatus('status-json', 'error',
        'This text cannot be converted to ' + F.label + '.',
        'It does not appear to be ' + F.label + ' or a near-' + F.label + ' structure. Plain prose cannot be converted.');
    } else {
      showStatus('status-json', 'error',
        'Could not fully auto-fix this input.',
        'Applied repairs:\n' + fixResult.notes.map(n => '• ' + n).join('\n') +
        '\n\nRemaining error:\n' + F.describeError(fixResult.fixed, afterErr));
    }
    document.getElementById('json-output').innerHTML = '<div class="output-empty">Nothing to display.</div>';
    State.parsed = null;
  }
}

document.getElementById('btn-expand-all').addEventListener('click', () => {
  document.querySelectorAll('#json-output .tree-node.collapsed').forEach(n => n.classList.remove('collapsed'));
});
document.getElementById('btn-collapse-all').addEventListener('click', () => {
  document.querySelectorAll('#json-output .tree-node').forEach(n => {
    if (!n.classList.contains('leaf')) n.classList.add('collapsed');
  });
});

function copyToClipboard(text) {
  return new Promise((resolve, reject) => {
    
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(resolve).catch(() => fallback());
    } else {
      fallback();
    }
    function fallback() {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.left = '0';
        ta.style.width = '1px';
        ta.style.height = '1px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, text.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) resolve();
        else reject(new Error('execCommand copy returned false'));
      } catch (e) {
        reject(e);
      }
    }
  });
}

document.getElementById('btn-copy-input').addEventListener('click', () => {
  copyToClipboard(jsonInput.value).then(() => {
    showStatus('status-json', 'info', 'Copied input to clipboard.', '');
    setTimeout(() => hideStatus('status-json'), 1500);
  }).catch(e => {
    showStatus('status-json', 'error', 'Copy failed.', 'Your browser blocked clipboard access. Select the text manually and use Ctrl/Cmd+C. (' + e.message + ')');
  });
});
document.getElementById('btn-copy-output').addEventListener('click', () => {
  if (State.parsed === null || State.parsed === undefined) {
    showStatus('status-json', 'error', 'Nothing to copy.', 'Parse some JSON first.');
    return;
  }
  copyToClipboard(JSON.stringify(State.parsed, null, 2)).then(() => {
    showStatus('status-json', 'info', 'Copied JSON to clipboard.', '');
    setTimeout(() => hideStatus('status-json'), 1500);
  }).catch(e => {
    showStatus('status-json', 'error', 'Copy failed.', 'Your browser blocked clipboard access. (' + e.message + ')');
  });
});

document.getElementById('btn-clear-json').addEventListener('click', () => {
  jsonInput.value = '';
  State.parsed = null;
  document.getElementById('json-output').innerHTML = '<div class="output-empty">Parsed output will appear here.</div>';
  document.getElementById('types-output-1').innerHTML = '<div class="output-empty">Parse some content to see each field\'s inferred type.</div>';
  hideStatus('status-json');
  resetPdfJsons();
});

document.getElementById('btn-copy-types-1').addEventListener('click', () => {
  if (State.parsed === null || State.parsed === undefined) {
    showStatus('status-json', 'error', 'Nothing to copy.', 'Parse some content first.');
    return;
  }
  copyToClipboard(typeTreeAsText(State.parsed)).then(() => {
    showStatus('status-json', 'info', 'Copied type tree to clipboard.', '');
    setTimeout(() => hideStatus('status-json'), 1500);
  }).catch(e => {
    showStatus('status-json', 'error', 'Copy failed.', e.message);
  });
});

const downloadFormat = document.getElementById('download-format');
const btnDownload = document.getElementById('btn-download');

btnDownload.addEventListener('click', () => {
  if (State.parsed === null || State.parsed === undefined) {
    showStatus('status-json', 'error', 'Nothing to download.', 'Parse some JSON first.');
    return;
  }
  downloadAs(downloadFormat.value);
});

function downloadAs(format) {
  const data = State.parsed;
  if (data === null || data === undefined) return;
  const base = 'data-' + new Date().toISOString().slice(0, 19).replace(/[:]/g, '');

  try {
    if (format === 'json') {
      downloadBlob(JSON.stringify(data, null, 2), base + '.json', 'application/json');
    } else if (format === 'txt') {
      downloadBlob(JSON.stringify(data, null, 2), base + '.txt', 'text/plain');
    } else if (format === 'csv') {
      const csv = jsonToCsv(data);
      downloadBlob(csv, base + '.csv', 'text/csv');
    } else if (format === 'xlsx') {
      jsonToXlsx(data, base + '.xlsx');
    } else if (format === 'html') {
      const html = jsonToHtmlReport(data);
      downloadBlob(html, base + '.html', 'text/html');
    } else if (format === 'pdf') {
      jsonToPdf(data, base + '.pdf');
    }
    showStatus('status-json', 'success', 'Downloaded as ' + format.toUpperCase() + '.', '');
    setTimeout(() => hideStatus('status-json'), 1800);
  } catch (e) {
    showStatus('status-json', 'error', 'Download failed.', e.message);
  }
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function jsonToCsv(data) {
  
  const arr = pickTabularArray(data) || flattenToRows(data);
  return Papa.unparse(arr);
}

function jsonToXlsx(data, filename) {
  const arr = pickTabularArray(data) || flattenToRows(data);
  const ws = XLSX.utils.json_to_sheet(arr);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  XLSX.writeFile(wb, filename);
}

function pickTabularArray(data) {
  if (Array.isArray(data) && data.length && data.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
    
    return data.map(row => {
      const o = {};
      for (const k of Object.keys(row)) {
        const v = row[k];
        o[k] = (v && typeof v === 'object') ? JSON.stringify(v) : v;
      }
      return o;
    });
  }
  if (data && typeof data === 'object') {
    for (const k of Object.keys(data)) {
      const v = data[k];
      if (Array.isArray(v) && v.length && v.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
        return v.map(row => {
          const o = {};
          for (const kk of Object.keys(row)) {
            const vv = row[kk];
            o[kk] = (vv && typeof vv === 'object') ? JSON.stringify(vv) : vv;
          }
          return o;
        });
      }
    }
  }
  return null;
}

function flattenToRows(data) {
  const rows = [];
  flatten(data, '', rows);
  return rows.map(r => ({ path: r.path, type: r.type, value: (r.value && typeof r.value === 'object') ? JSON.stringify(r.value) : r.value }));
}

function jsonToHtmlReport(data) {
  const tableHtml = buildTable(data).outerHTML;
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>JSON Report</title>' +
    '<style>body{font-family:-apple-system,sans-serif;padding:24px;color:#171717}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:8px 12px;border-bottom:1px solid #e5e5e5;text-align:left}th{background:#fafafa;font-size:12px;text-transform:uppercase}h1{font-size:18px;margin-bottom:16px}.nested{font-family:monospace;font-size:11px;color:#525252;background:#fafafa}</style>' +
    '</head><body><h1>JSON Report — ' + new Date().toLocaleString() + '</h1>' + tableHtml + '</body></html>';
}

function jsonToPdf(data, filename) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const text = JSON.stringify(data, null, 2);
  const lines = doc.splitTextToSize(text, 520);
  doc.setFont('courier', 'normal');
  doc.setFontSize(9);
  let y = 40;
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('JSON Export', 40, y);
  y += 20;
  doc.setFont('courier', 'normal');
  doc.setFontSize(9);
  lines.forEach(line => {
    if (y > pageH - 40) { doc.addPage(); y = 40; }
    doc.text(line, 40, y);
    y += 11;
  });
  doc.save(filename);
}

setupDropzone('dropzone-json', 'file-json', handleJsonFile);

function setupDropzone(zoneId, inputId, handler) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handler(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', e => {
    if (e.target.files.length) handler(e.target.files[0]);
  });
}

const PdfJsons = {
  list: [],            
  selectedIndex: -1,
};

function resetPdfJsons() {
  PdfJsons.list = [];
  PdfJsons.selectedIndex = -1;
  const bar = document.getElementById('pdf-json-selector-bar');
  if (bar) bar.style.display = 'none';
  const sel = document.getElementById('pdf-json-select');
  if (sel) sel.innerHTML = '';
}

async function handleJsonFile(file) {
  const name = file.name.toLowerCase();
  showStatus('status-json', 'info', 'Reading file...', file.name);
  resetPdfJsons();
  try {
    if (name.endsWith('.pdf') || file.type === 'application/pdf') {
      const { text, pageBreaks } = await extractTextFromPdf(file);
      const jsons = extractAllJsonsFromText(text, pageBreaks);

      if (jsons.length === 0) {
        showStatus('status-json', 'warn',
          'No JSON detected inside the PDF.',
          'Showing extracted text — you can edit it manually and try Auto-fix & Parse.');
        jsonInput.value = text;
        return;
      }

      PdfJsons.list = jsons;

      if (jsons.length === 1) {
        
        PdfJsons.selectedIndex = 0;
        jsonInput.value = jsons[0].text;
        showStatus('status-json', 'success', 'Extracted JSON from PDF.',
          'Found 1 JSON document (' + (jsons[0].label || '') + '). Click Parse or Auto-fix.');
        doParse(true);
        return;
      }

      
      const sel = document.getElementById('pdf-json-select');
      sel.innerHTML = jsons.map((j, i) => {
        const pageInfo = j.page ? ' (page ' + j.page + (j.pageEnd && j.pageEnd !== j.page ? '–' + j.pageEnd : '') + ')' : '';
        const sizeInfo = ' — ' + humanBytes(new Blob([j.text]).size);
        return '<option value="' + i + '">' + escapeHtml((i + 1) + '. ' + j.label + pageInfo + sizeInfo) + '</option>';
      }).join('');

      document.getElementById('pdf-json-count-text').textContent = jsons.length + ' documents';
      document.getElementById('pdf-json-selector-bar').style.display = 'flex';

      
      PdfJsons.selectedIndex = 0;
      sel.value = 0;
      jsonInput.value = jsons[0].text;
      showStatus('status-json', 'info',
        'Found ' + jsons.length + ' JSON documents in PDF.',
        'Showing the first one. Use the document dropdown above to switch.');
      doParse(true);
    } else {
      const text = await file.text();
      jsonInput.value = text;
      showStatus('status-json', 'success', 'Loaded ' + file.name + '.', '');
      doParse(true);
    }
  } catch (e) {
    showStatus('status-json', 'error', 'Failed to read file.', e.message);
  }
}

document.getElementById('pdf-json-select') && document.getElementById('pdf-json-select').addEventListener('change', e => {
  const idx = parseInt(e.target.value, 10);
  if (Number.isNaN(idx) || idx < 0 || idx >= PdfJsons.list.length) return;
  PdfJsons.selectedIndex = idx;
  const j = PdfJsons.list[idx];
  jsonInput.value = j.text;
  showStatus('status-json', 'info',
    'Loaded JSON document ' + (idx + 1) + ' (' + j.label + ').',
    'Click Parse or Auto-fix to view its structure.');
  doParse(true);
});

async function extractTextFromPdf(file) {
  
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let full = '';
  
  const pageBreaks = []; 
  for (let i = 1; i <= pdf.numPages; i++) {
    pageBreaks.push({ pageNum: i, startOffset: full.length });
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    let lastY = null;
    let lineBuf = '';
    for (const item of tc.items) {
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        full += lineBuf + '\n';
        lineBuf = '';
      }
      lineBuf += item.str;
      lastY = y;
    }
    full += lineBuf + '\n';
  }
  return { text: full, pageBreaks };
}

function extractAllJsonsFromText(text, pageBreaks) {
  const found = []; 

  
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c !== '{' && c !== '[') { i++; continue; }

    const matchEnd = findMatchingBracket(text, i);
    if (matchEnd < 0) { i++; continue; }

    const candidate = text.slice(i, matchEnd + 1);
    let value = null;
    try { value = JSON.parse(candidate); }
    catch (_) {
      
      try {
        const fx = autoFixJson(candidate);
        value = JSON.parse(fx.fixed);
      } catch (_) {}
    }

    if (value !== null && value !== undefined && hasAtLeastOneKey(value)) {
      found.push({
        start: i,
        end: matchEnd,
        text: candidate,
        value,
      });
      
      i = matchEnd + 1;
      continue;
    }
    i++;
  }

  
  return found.map((f, idx) => {
    const page = pageForOffset(f.start, pageBreaks);
    const pageEnd = pageForOffset(f.end, pageBreaks);
    const label = labelForJson(f.value, text, f.start);
    return {
      text: f.text,
      value: f.value,
      label,
      page,
      pageEnd,
      start: f.start,
      end: f.end,
      isArray: Array.isArray(f.value),
    };
  });
}

function hasAtLeastOneKey(value) {
  if (Array.isArray(value)) {
    
    if (value.length === 0) return false;
    return true;
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).length >= 1;
  }
  return false;
}

function pageForOffset(offset, pageBreaks) {
  if (!pageBreaks || pageBreaks.length === 0) return null;
  let page = pageBreaks[0].pageNum;
  for (const pb of pageBreaks) {
    if (pb.startOffset <= offset) page = pb.pageNum;
    else break;
  }
  return page;
}

function labelForJson(value, fullText, startOffset) {
  
  const beforeText = fullText.slice(Math.max(0, startOffset - 250), startOffset);
  const lines = beforeText.split('\n');
  
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    
    if (/[{}[\],:"]$/.test(line)) break;
    
    if (line.length > 0 && line.length <= 80 && !/[.;]$/.test(line)) {
      
      const cleaned = line.replace(/^[#/\-=*\s]+/, '').replace(/[#/\-=*\s]+$/, '').trim();
      if (cleaned && cleaned.length >= 2) return cleaned.slice(0, 60);
    }
    break;
  }

  
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    const identifyKeys = ['name', 'title', 'label', 'id', 'transaction_id', 'order_id', 'customer_id',
                          'type', 'kind', 'event', 'event_type', 'subject'];
    for (const k of identifyKeys) {
      if (k in value && typeof value[k] !== 'object' && value[k] != null) {
        return k + ': ' + String(value[k]).slice(0, 40);
      }
    }
    
    for (const k of keys) {
      if (/_id$/i.test(k) && typeof value[k] !== 'object' && value[k] != null) {
        return k + ': ' + String(value[k]).slice(0, 40);
      }
    }
    
    for (const k of keys) {
      if (typeof value[k] !== 'object' && value[k] != null) {
        return k + ': ' + String(value[k]).slice(0, 40);
      }
    }
    
    return 'Object (' + keys.length + ' key' + (keys.length === 1 ? '' : 's') + ')';
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return 'Empty array';
    
    if (value[0] && typeof value[0] === 'object') {
      const innerLabel = labelForJson(value[0], '', 0);
      return 'Array of ' + value.length + ' — first: ' + innerLabel;
    }
    return 'Array of ' + value.length + ' ' + typeof value[0] + 's';
  }

  return 'JSON document';
}

function findMatchingBracket(text, start) {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

const dataInput = document.getElementById('data-input');
const dataOutput = document.getElementById('data-output');

document.getElementById('btn-to-json').addEventListener('click', convertToJson);

function convertToJson() {
  const text = dataInput.value.trim();
  if (!text) {
    showStatus('status-data', 'error', 'No input', 'Paste CSV/TSV data, or upload a file.');
    return;
  }
  const delim = document.getElementById('csv-delim').value;
  let shape = document.getElementById('json-shape').value;
  try {
    const parsed = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,   
      delimiter: delim === 'auto' ? '' : (delim === '\\t' ? '\t' : delim),
    });
    if (parsed.errors && parsed.errors.length) {
      if (!parsed.data || !parsed.data.length) {
        showStatus('status-data', 'error', 'Could not parse table.', parsed.errors[0].message);
        return;
      }
    }

    
    coerceCellTypes(parsed.data);

    
    const fields = parsed.meta && parsed.meta.fields ? parsed.meta.fields : Object.keys(parsed.data[0] || {});
    const jsonCellStats = parseJsonStringCells(parsed.data);

    
    let autoShapeMsg = '';
    if (shape === 'auto') {
      const hasDotted = fields.some(f => f && f.includes('.'));
      if (hasDotted) {
        shape = 'nested';
        autoShapeMsg = 'Detected dot-notation headers — using nested shape.';
      } else if (parsed.data.length === 1) {
        
        shape = 'single';
        autoShapeMsg = 'Detected single-row data — output as a single object.';
      } else {
        shape = 'array';
        autoShapeMsg = 'Using array-of-objects shape.';
      }
    }

    let result = shapeJson(parsed.data, shape);
    State.parsedFromData = result;
    renderDataOutput(result);

    
    const lines = ['Converted ' + parsed.data.length + ' row(s) to JSON.'];
    if (autoShapeMsg) lines.push(autoShapeMsg);
    if (jsonCellStats.parsedCells > 0) {
      lines.push('Detected & expanded ' + jsonCellStats.parsedCells + ' JSON-string cell(s) into nested objects/arrays' +
        (jsonCellStats.columns.length ? ' (columns: ' + jsonCellStats.columns.slice(0, 5).join(', ') + (jsonCellStats.columns.length > 5 ? ', …' : '') + ')' : '') + '.');
    }
    if (parsed.errors && parsed.errors.length) {
      showStatus('status-data', 'warn', lines[0], lines.slice(1).concat(['Warnings:'].concat(parsed.errors.slice(0,3).map(e => '• ' + e.message))).join('\n'));
    } else {
      showStatus('status-data', 'success', lines[0], lines.slice(1).join('\n'));
    }
  } catch (e) {
    showStatus('status-data', 'error', 'Conversion failed.', e.message);
  }
}

function coerceCellTypes(rows) {
  const isoDateRe = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
  const numRe = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    for (const k of Object.keys(row)) {
      const v = row[k];
      if (typeof v !== 'string') continue;
      const t = v.trim();
      if (t === '') { row[k] = null; continue; }
      if (t === 'null' || t === 'NULL') { row[k] = null; continue; }
      if (t === 'true' || t === 'TRUE' || t === 'True') { row[k] = true; continue; }
      if (t === 'false' || t === 'FALSE' || t === 'False') { row[k] = false; continue; }
      if (isoDateRe.test(t)) continue; 
      if (numRe.test(t)) {
        const n = Number(t);
        if (Number.isFinite(n)) row[k] = n;
      }
    }
  }
}

function parseJsonStringCells(rows) {
  let parsedCells = 0;
  const columnsSet = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    for (const k of Object.keys(row)) {
      const v = row[k];
      if (typeof v !== 'string') continue;
      const trimmed = v.trim();
      if (!trimmed) continue;
      const first = trimmed[0];
      const last = trimmed[trimmed.length - 1];
      
      if (!((first === '[' && last === ']') || (first === '{' && last === '}'))) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed !== null && typeof parsed === 'object') {
          row[k] = parsed;
          parsedCells++;
          columnsSet.add(k);
        }
      } catch (_) {
        
        try {
          const unescaped = trimmed.replace(/""/g, '"');
          if (unescaped !== trimmed) {
            const parsed = JSON.parse(unescaped);
            if (parsed !== null && typeof parsed === 'object') {
              row[k] = parsed;
              parsedCells++;
              columnsSet.add(k);
            }
          }
        } catch (_) {
          
        }
      }
    }
  }
  return { parsedCells, columns: [...columnsSet] };
}

function shapeJson(rows, shape) {
  if (shape === 'array') return rows;
  if (shape === 'single') {
    return rows.length === 1 ? rows[0] : rows;
  }
  if (shape === 'keyed') {
    const out = {};
    rows.forEach((row, i) => {
      const keys = Object.keys(row);
      const keyCol = keys[0];
      const key = row[keyCol] != null ? String(row[keyCol]) : 'row_' + (i + 1);
      const rest = {};
      for (let j = 1; j < keys.length; j++) rest[keys[j]] = row[keys[j]];
      out[key] = rest;
    });
    return out;
  }
  if (shape === 'columns') {
    const out = {};
    if (!rows.length) return out;
    const keys = Object.keys(rows[0]);
    keys.forEach(k => out[k] = rows.map(r => r[k]));
    return out;
  }
  if (shape === 'nested') {
    const result = rows.map(row => {
      const out = {};
      Object.keys(row).forEach(k => setDeep(out, k.split('.'), row[k]));
      return out;
    });
    
    return result.length === 1 ? result[0] : result;
  }
  return rows;
}

function setDeep(obj, path, value) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (typeof cur[path[i]] !== 'object' || cur[path[i]] === null || Array.isArray(cur[path[i]])) cur[path[i]] = {};
    cur = cur[path[i]];
  }
  cur[path[path.length - 1]] = value;
}

function dataOutFormat() {
  const sel = document.getElementById('data-output-format');
  return sel && sel.value === 'yaml' ? Format.yaml : Format.json;
}

function renderDataOutput(obj) {
  dataOutput.innerHTML = '';
  const F = dataOutFormat();
  const text = F.stringify(obj);
  const pre = document.createElement('pre');
  pre.className = 'json-view';
  if (F === Format.json) pre.innerHTML = syntaxHighlightJson(text);
  else pre.textContent = text;
  dataOutput.appendChild(pre);
  
  document.getElementById('data-output-label').textContent = F.label;
  
  renderTypesInto('types-output-2', obj);
}

document.addEventListener('change', e => {
  if (e.target && e.target.id === 'data-output-format') {
    const btn = document.getElementById('btn-to-json');
    if (btn) btn.textContent = 'Convert to ' + (e.target.value === 'yaml' ? 'YAML' : 'JSON');
    if (State.parsedFromData) renderDataOutput(State.parsedFromData);
  }
});

document.getElementById('btn-copy-json-out').addEventListener('click', () => {
  if (!State.parsedFromData) {
    showStatus('status-data', 'error', 'Nothing to copy.', 'Convert some data first.');
    return;
  }
  const F = dataOutFormat();
  copyToClipboard(F.stringify(State.parsedFromData)).then(() => {
    showStatus('status-data', 'info', 'Copied ' + F.label + ' to clipboard.', '');
    setTimeout(() => hideStatus('status-data'), 1500);
  }).catch(e => {
    showStatus('status-data', 'error', 'Copy failed.', 'Your browser blocked clipboard access. (' + e.message + ')');
  });
});
document.getElementById('btn-download-json-out').addEventListener('click', () => {
  if (!State.parsedFromData) {
    showStatus('status-data', 'error', 'Nothing to download.', 'Convert some data first.');
    return;
  }
  const F = dataOutFormat();
  downloadBlob(F.stringify(State.parsedFromData), 'converted.' + F.ext, F.mime);
});
document.getElementById('btn-clear-data').addEventListener('click', () => {
  dataInput.value = '';
  State.parsedFromData = null;
  dataOutput.innerHTML = '<div class="output-empty">Generated output will appear here.</div>';
  document.getElementById('types-output-2').innerHTML = '<div class="output-empty">Convert some data to see each field\'s inferred type.</div>';
  hideStatus('status-data');
  resetWorkbookState();
});

document.getElementById('btn-copy-types-2').addEventListener('click', () => {
  if (!State.parsedFromData) {
    showStatus('status-data', 'error', 'Nothing to copy.', 'Convert some data first.');
    return;
  }
  copyToClipboard(typeTreeAsText(State.parsedFromData)).then(() => {
    showStatus('status-data', 'info', 'Copied type tree to clipboard.', '');
    setTimeout(() => hideStatus('status-data'), 1500);
  }).catch(e => {
    showStatus('status-data', 'error', 'Copy failed.', e.message);
  });
});

const Workbook = {
  wb: null,           
  sheets: [],         
  selectedSheet: null,
  fileName: null,
};

function resetWorkbookState() {
  Workbook.wb = null;
  Workbook.sheets = [];
  Workbook.selectedSheet = null;
  Workbook.fileName = null;
  document.getElementById('sheet-selector-bar').style.display = 'none';
  document.getElementById('sheet-select').innerHTML = '';
}

function loadSelectedSheet() {
  if (!Workbook.wb || !Workbook.selectedSheet) return;
  try {
    const ws = Workbook.wb.Sheets[Workbook.selectedSheet];
    if (!ws) {
      showStatus('status-data', 'error', 'Sheet not found.', 'The sheet "' + Workbook.selectedSheet + '" no longer exists in the workbook.');
      return;
    }
    const csv = XLSX.utils.sheet_to_csv(ws);
    dataInput.value = csv;
    showStatus('status-data', 'info', 'Loaded sheet "' + Workbook.selectedSheet + '" from ' + Workbook.fileName + '.',
      Workbook.sheets.length > 1 ? 'Use the sheet dropdown above to switch to another sheet.' : '');
    convertToJson();
  } catch (e) {
    showStatus('status-data', 'error', 'Failed to load sheet.', e.message);
  }
}

document.getElementById('sheet-select').addEventListener('change', e => {
  Workbook.selectedSheet = e.target.value;
  loadSelectedSheet();
});

setupDropzone('dropzone-data', 'file-data', handleDataFile);

async function handleDataFile(file) {
  const name = file.name.toLowerCase();
  showStatus('status-data', 'info', 'Reading file...', file.name);
  try {
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheets = wb.SheetNames;
      if (!sheets.length) {
        showStatus('status-data', 'error', 'No sheets found.', 'The workbook contains no sheets.');
        return;
      }

      
      Workbook.wb = wb;
      Workbook.sheets = sheets;
      Workbook.fileName = file.name;

      
      const select = document.getElementById('sheet-select');
      const bar = document.getElementById('sheet-selector-bar');
      select.innerHTML = sheets.map((s, i) => {
        const ws = wb.Sheets[s];
        const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
        const rows = range ? (range.e.r - range.s.r + 1) : 0;
        const cols = range ? (range.e.c - range.s.c + 1) : 0;
        const meta = rows && cols ? ' — ' + rows + ' × ' + cols : ' — empty';
        return '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + meta + '</option>';
      }).join('');

      
      if (sheets.length > 1) {
        document.getElementById('sheet-count-text').textContent =
          sheets.length + ' sheets';
        bar.style.display = 'flex';
      } else {
        bar.style.display = 'none';
      }

      
      Workbook.selectedSheet = sheets[0];
      select.value = sheets[0];

      
      loadSelectedSheet();

      
      if (sheets.length > 1) {
        showStatus('status-data', 'info',
          'Workbook loaded: ' + sheets.length + ' sheets.',
          'Showing first sheet "' + sheets[0] + '". Use the sheet dropdown above to switch.');
      }
    } else {
      
      resetWorkbookState();
      const text = await file.text();
      dataInput.value = text;
      showStatus('status-data', 'success', 'Loaded ' + file.name + '.', '');
      convertToJson();
    }
  } catch (e) {
    showStatus('status-data', 'error', 'Failed to read file.', e.message);
  }
}

const explainInput = document.getElementById('explain-input');
const explainOutput = document.getElementById('explain-output');

document.getElementById('btn-explain').addEventListener('click', doExplain);
document.getElementById('btn-clear-explain').addEventListener('click', () => {
  explainInput.value = '';
  State.parsedForExplain = null;
  explainOutput.innerHTML = '<div class="output-empty">Each key, its type, and example values will be listed here.</div>';
  hideStatus('status-explain');
  document.getElementById('key-search-input').value = '';
  runKeySearch();
});

function doExplain() {
  const text = explainInput.value;
  const F = fmt();
  if (!text.trim()) {
    showStatus('status-explain', 'error', 'No input', 'Paste some ' + F.label + ' to explain.');
    return;
  }
  let value;
  try {
    value = F.parseStrict(text);
  } catch (_) {
    try {
      const fx = F.autoFix(text);
      value = F.parseStrict(fx.fixed);
    } catch (e2) {
      showStatus('status-explain', 'error', 'Could not parse ' + F.label + '.',
        'Try the ' + F.label + ' → View tab first to fix the input.\n\n' + e2.message);
      return;
    }
  }
  State.parsedForExplain = value;
  const depth = document.getElementById('explain-depth').value;
  renderExplanation(value, depth);
  showStatus('status-explain', 'success', 'Generated structure breakdown.', '');
}

function renderExplanation(data, depth) {
  explainOutput.innerHTML = '';
  const rootInfo = document.createElement('div');
  rootInfo.className = 'explain-section clickable';
  rootInfo.dataset.path = '$';
  rootInfo.dataset.key = '$';
  rootInfo.title = 'Click to locate in JSON';
  rootInfo.innerHTML =
    '<div class="explain-key">$ (root)</div>' +
    '<div class="explain-meta"><span class="explain-tag type-' + typeOf(data) + '">' + typeOf(data) + '</span></div>' +
    '<div class="explain-desc">' + describeRoot(data) + '</div>';
  explainOutput.appendChild(rootInfo);

  
  const entries = [];
  collectExplain(data, '$', entries, 0, depth === 'overview' ? 3 : 50);

  entries.forEach(e => {
    const section = document.createElement('div');
    section.className = 'explain-section clickable';
    section.dataset.path = e.path;
    section.dataset.key = e.key;
    section.title = 'Click to locate "' + e.key + '" in the JSON input';
    section.innerHTML =
      '<div class="explain-key">' + escapeHtml(e.path) + '</div>' +
      '<div class="explain-meta">' +
        '<span class="explain-tag type-' + e.type + '">' + e.type + '</span>' +
        (e.length != null ? '<span class="explain-tag">' + e.length + ' ' + (e.type === 'array' ? 'items' : 'keys') + '</span>' : '') +
        (e.itemType ? '<span class="explain-tag">items: ' + e.itemType + '</span>' : '') +
      '</div>' +
      '<div class="explain-desc">' + escapeHtml(describeKey(e)) + '</div>' +
      (e.example !== undefined ? '<div class="explain-example">' + escapeHtml(typeof e.example === 'string' ? e.example : JSON.stringify(e.example, null, 2)) + '</div>' : '');
    explainOutput.appendChild(section);
  });

  
  if (document.getElementById('key-search-input').value.trim()) {
    runKeySearch();
  }
}

function describeRoot(data) {
  const t = typeOf(data);
  if (t === 'object') return 'The root is an object with ' + Object.keys(data).length + ' top-level key(s).';
  if (t === 'array') return 'The root is an array containing ' + data.length + ' item(s).';
  return 'The root is a primitive ' + t + ' value.';
}

function collectExplain(value, path, out, depth, maxDepth) {
  if (depth > maxDepth) return;
  const t = typeOf(value);
  if (t === 'object') {
    Object.keys(value).forEach(k => {
      try {
        const v = value[k];
        const childPath = path + '.' + k;
        const entry = { path: childPath, key: k, type: typeOf(v) };
        if (Array.isArray(v)) {
          entry.length = v.length;
          entry.itemType = inferArrayItemType(v);
          if (v.length) entry.example = shallowPreview(v[0]);
        } else if (v && typeof v === 'object') {
          entry.length = Object.keys(v).length;
          entry.example = preview(v);
        } else {
          entry.example = v;
        }
        out.push(entry);
        collectExplain(v, childPath, out, depth + 1, maxDepth);
      } catch (err) {
        out.push({ path: path + '.' + k, key: k, type: 'unknown', example: '(could not inspect: ' + err.message + ')' });
      }
    });
  } else if (t === 'array') {
    if (value.length > 0) {
      try {
        const first = value[0];
        const childPath = path + '[0]';
        const entry = { path: childPath, key: '0', type: typeOf(first) };
        if (Array.isArray(first)) {
          entry.length = first.length;
          entry.itemType = inferArrayItemType(first);
        } else if (first && typeof first === 'object') {
          entry.length = Object.keys(first).length;
          entry.example = preview(first);
        } else {
          entry.example = first;
        }
        out.push(entry);
        collectExplain(first, childPath, out, depth + 1, maxDepth);
      } catch (err) {
        out.push({ path: path + '[0]', key: '0', type: 'unknown', example: '(could not inspect: ' + err.message + ')' });
      }
    }
  }
}

function inferArrayItemType(arr) {
  if (!arr.length) return 'empty';
  const types = new Set(arr.map(typeOf));
  if (types.size === 1) return [...types][0];
  return [...types].join(' | ');
}

function preview(v) {
  
  if (Array.isArray(v)) {
    return v.slice(0, 3).map(shallowPreview).concat(v.length > 3 ? ['...'] : []);
  }
  if (v && typeof v === 'object') {
    const out = {};
    const keys = Object.keys(v).slice(0, 8);
    for (const k of keys) out[k] = shallowPreview(v[k]);
    if (Object.keys(v).length > 8) out['...'] = '...';
    return out;
  }
  return v;
}

function shallowPreview(v) {
  if (v === null) return null;
  if (Array.isArray(v)) return v.length === 0 ? [] : '[' + v.length + ' items]';
  if (typeof v === 'object') return '{' + Object.keys(v).length + ' keys}';
  if (typeof v === 'string') return v.length > 60 ? v.slice(0, 60) + '...' : v;
  return v;
}

function describeKey(e) {
  const k = e.key;
  const t = e.type;
  const semantic = guessSemanticMeaning(k, e.example);
  let base = '';
  if (t === 'string') base = 'A text value';
  else if (t === 'number') base = 'A numeric value';
  else if (t === 'boolean') base = 'A boolean flag (true or false)';
  else if (t === 'null') base = 'Explicitly null — no value provided';
  else if (t === 'array') base = 'An array containing ' + (e.length || 0) + ' item(s)' + (e.itemType ? ' of type ' + e.itemType : '');
  else if (t === 'object') base = 'A nested object with ' + (e.length || 0) + ' field(s)';
  return base + (semantic ? '. ' + semantic : '') + '.';
}

function guessSemanticMeaning(key, example) {
  const k = String(key).toLowerCase();
  if (/^id$|_id$|^uuid$/i.test(key)) return 'Looks like a unique identifier';
  if (/email/.test(k)) return 'Likely an email address';
  if (/phone|mobile|tel/.test(k)) return 'Likely a phone number';
  if (/url|link|href/.test(k)) return 'Likely a URL';
  if (/date|time|created|updated|timestamp/.test(k)) return 'Likely a date or timestamp';
  if (/price|amount|cost|total|fee/.test(k)) return 'Likely a monetary amount';
  if (/name|title|label/.test(k)) return 'A human-readable name or label';
  if (/status|state/.test(k)) return 'Represents a status or state';
  if (/count|qty|quantity|num/.test(k)) return 'A count or quantity';
  if (/active|enabled|is_/.test(k)) return 'A boolean flag';
  if (/lat|latitude/.test(k)) return 'A latitude coordinate';
  if (/lng|lon|longitude/.test(k)) return 'A longitude coordinate';
  if (/address/.test(k)) return 'A postal or street address';
  return '';
}

const keySearchInput = document.getElementById('key-search-input');
const keySearchMeta = document.getElementById('key-search-meta');
const btnSearchPrev = document.getElementById('btn-search-prev');
const btnSearchNext = document.getElementById('btn-search-next');
const btnSearchClear = document.getElementById('btn-search-clear');

const Search = {
  matches: [],      
  current: -1,      
  lastQuery: '',
};

function runKeySearch() {
  const query = keySearchInput.value.trim();
  
  document.querySelectorAll('#explain-output .explain-section').forEach(s => {
    s.classList.remove('match', 'match-current');
    
    const keyEl = s.querySelector('.explain-key');
    if (keyEl && keyEl.dataset.original !== undefined) {
      keyEl.innerHTML = keyEl.dataset.original;
    }
  });
  Search.matches = [];
  Search.current = -1;

  if (!query) {
    keySearchMeta.textContent = '';
    keySearchMeta.className = 'search-meta';
    btnSearchPrev.disabled = true;
    btnSearchNext.disabled = true;
    return;
  }

  
  const sections = document.querySelectorAll('#explain-output .explain-section');
  if (!sections.length || !State.parsedForExplain) {
    keySearchMeta.textContent = '—';
    keySearchMeta.className = 'search-meta no-results';
    btnSearchPrev.disabled = true;
    btnSearchNext.disabled = true;
    return;
  }

  const lowerQ = query.toLowerCase();
  
  const normalizedQ = lowerQ.replace(/^\$?\.?/, '').replace(/\s+/g, '');

  
  
  
  const parts = lowerQ.split(/[\s>]+/).filter(Boolean);
  const isMultiPart = parts.length > 1;

  sections.forEach(section => {
    const path = (section.dataset.path || '').toLowerCase();
    const key = (section.dataset.key || '').toLowerCase();
    const normalizedPath = path.replace(/^\$\.?/, '');

    
    
    
    
    
    const isExactKey = key === lowerQ;
    const isKeyPartial = !isMultiPart && key.includes(lowerQ);
    const isPathFragment = !isMultiPart && normalizedQ && normalizedPath.includes(normalizedQ);
    let isMultiPartMatch = false;
    if (isMultiPart) {
      let cursor = 0;
      isMultiPartMatch = parts.every(p => {
        const idx = path.indexOf(p, cursor);
        if (idx === -1) return false;
        cursor = idx + p.length;
        return true;
      });
    }

    if (isExactKey || isKeyPartial || isPathFragment || isMultiPartMatch) {
      section.classList.add('match');
      Search.matches.push(section);

      
      const keyEl = section.querySelector('.explain-key');
      if (keyEl) {
        if (keyEl.dataset.original === undefined) {
          keyEl.dataset.original = keyEl.innerHTML;
        }
        const original = keyEl.dataset.original;
        keyEl.innerHTML = highlightInText(original, query);
      }
    }
  });

  if (Search.matches.length === 0) {
    keySearchMeta.textContent = 'No matches';
    keySearchMeta.className = 'search-meta no-results';
    btnSearchPrev.disabled = true;
    btnSearchNext.disabled = true;
  } else {
    Search.current = 0;
    keySearchMeta.className = 'search-meta has-results';
    btnSearchPrev.disabled = false;
    btnSearchNext.disabled = false;
    focusMatch(0);
  }
}

function focusMatch(index) {
  if (!Search.matches.length) return;
  
  Search.matches.forEach(m => m.classList.remove('match-current'));
  document.querySelectorAll('mark.search-hit-current').forEach(m => {
    m.classList.remove('search-hit-current');
    m.classList.add('search-hit');
  });

  Search.current = ((index % Search.matches.length) + Search.matches.length) % Search.matches.length;
  const el = Search.matches[Search.current];
  el.classList.add('match-current');

  
  el.querySelectorAll('mark.search-hit').forEach(m => {
    m.classList.remove('search-hit');
    m.classList.add('search-hit-current');
  });

  
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });

  keySearchMeta.textContent = (Search.current + 1) + ' of ' + Search.matches.length;
}

function highlightInText(html, query) {
  
  
  if (!query) return html;
  
  const safe = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(' + safe + ')', 'gi');
  return html.replace(re, '<mark class="search-hit">$1</mark>');
}

let searchDebounce;
keySearchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(runKeySearch, 150);
});

keySearchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (Search.matches.length) {
      focusMatch(e.shiftKey ? Search.current - 1 : Search.current + 1);
    } else {
      runKeySearch();
    }
  } else if (e.key === 'Escape') {
    keySearchInput.value = '';
    runKeySearch();
  }
});

btnSearchNext.addEventListener('click', () => {
  if (Search.matches.length) focusMatch(Search.current + 1);
});
btnSearchPrev.addEventListener('click', () => {
  if (Search.matches.length) focusMatch(Search.current - 1);
});
btnSearchClear.addEventListener('click', () => {
  keySearchInput.value = '';
  runKeySearch();
  keySearchInput.focus();
});

explainOutput.addEventListener('click', e => {
  const section = e.target.closest('.explain-section.clickable');
  if (!section) return;
  const path = section.dataset.path;
  const key = section.dataset.key;
  if (!path || path === '$') return;  

  
  const text = explainInput.value;
  let pos = null;
  if (State.activeFormat === 'json') {
    pos = findKeyPositionInJsonText(text, path, key);
  }
  if (!pos) {
    
    pos = findKeyByTextSearch(text, key, State.activeFormat);
  }
  if (pos) {
    selectInTextarea(explainInput, pos.start, pos.end);
    flashSection(section, 'success');
  } else {
    flashSection(section, 'error');
    showStatus('status-explain', 'warn',
      'Could not locate key in the source text.',
      'The key "' + key + '" exists in the parsed structure, but its position in the raw text could not be determined.');
    setTimeout(() => hideStatus('status-explain'), 4000);
  }
});

function findKeyByTextSearch(text, key, format) {
  if (!key || key === '$' || /^\d+$/.test(key)) return null;
  let pattern;
  if (format === 'json') {
    
    pattern = new RegExp('"' + escapeRegex(key) + '"\\s*:', 'g');
  } else if (format === 'yaml') {
    
    pattern = new RegExp('(^|\\n)(\\s*)["\']?' + escapeRegex(key) + '["\']?\\s*:', 'g');
  } else if (format === 'xml') {
    
    pattern = new RegExp('<(?:[\\w\\-]+:)?' + escapeRegex(key) + '(?=[\\s/>])', 'g');
  } else {
    return null;
  }
  const m = pattern.exec(text);
  if (!m) return null;
  
  const offset = m[0].indexOf(key);
  if (offset < 0) return null;
  const start = m.index + offset;
  return { start, end: start + key.length };
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function findKeyPositionInJsonText(text, path, finalKey) {
  
  
  const segments = parseJsonPath(path);
  if (!segments.length) return null;

  
  
  let i = 0;
  const len = text.length;
  
  const stack = [];
  let matchedSoFar = 0; 

  function skipWhitespace() {
    while (i < len && /\s/.test(text[i])) i++;
  }
  function readString() {
    
    if (text[i] !== '"') return null;
    const start = i;
    i++;
    while (i < len) {
      const c = text[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '"') { i++; return { start, end: i, value: text.slice(start + 1, i - 1) }; }
      i++;
    }
    return null;
  }
  function readPrimitiveOrSkipUntilValueEnd() {
    
    skipWhitespace();
    const c = text[i];
    if (c === '"') { readString(); return; }
    if (c === '{' || c === '[') { skipContainer(); return; }
    
    while (i < len && !/[\s,\]}]/.test(text[i])) i++;
  }
  function skipContainer() {
    
    const open = text[i];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    while (i < len) {
      const c = text[i];
      if (inStr) {
        if (c === '\\') { i += 2; continue; }
        if (c === '"') inStr = false;
        i++;
        continue;
      }
      if (c === '"') { inStr = true; i++; continue; }
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) { i++; return; } }
      i++;
    }
  }

  
  function walkValue() {
    skipWhitespace();
    if (i >= len) return null;
    const c = text[i];

    if (c === '{') {
      
      i++; 
      skipWhitespace();
      if (text[i] === '}') { i++; return null; }

      while (i < len) {
        skipWhitespace();
        
        const keyStart = i;
        const key = readString();
        if (!key) return null;
        skipWhitespace();
        if (text[i] !== ':') return null;
        i++;

        
        const expectedSeg = segments[matchedSoFar];
        if (typeof expectedSeg === 'string' && expectedSeg === key.value) {
          
          if (matchedSoFar === segments.length - 1) {
            return { start: key.start, end: key.end };
          }
          
          matchedSoFar++;
          const result = walkValue();
          if (result) return result;
          matchedSoFar--;
          
        } else {
          
          readPrimitiveOrSkipUntilValueEnd();
        }

        skipWhitespace();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return null; }
        if (i >= len) return null;
      }
      return null;
    }

    if (c === '[') {
      i++; 
      skipWhitespace();
      if (text[i] === ']') { i++; return null; }

      let idx = 0;
      while (i < len) {
        skipWhitespace();
        const expectedSeg = segments[matchedSoFar];
        if (typeof expectedSeg === 'number' && expectedSeg === idx) {
          if (matchedSoFar === segments.length - 1) {
            
            const valStart = i;
            
            readPrimitiveOrSkipUntilValueEnd();
            return { start: valStart, end: i };
          }
          matchedSoFar++;
          const result = walkValue();
          if (result) return result;
          matchedSoFar--;
        } else {
          readPrimitiveOrSkipUntilValueEnd();
        }
        skipWhitespace();
        if (text[i] === ',') { i++; idx++; continue; }
        if (text[i] === ']') { i++; return null; }
        if (i >= len) return null;
      }
      return null;
    }

    
    readPrimitiveOrSkipUntilValueEnd();
    return null;
  }

  return walkValue();
}

function parseJsonPath(path) {
  const segs = [];
  
  let p = path.replace(/^\$\.?/, '');
  if (!p) return segs;
  
  const re = /([^.\[\]]+)|\[(\d+)\]/g;
  let m;
  while ((m = re.exec(p)) !== null) {
    if (m[1] !== undefined) segs.push(m[1]);
    else segs.push(parseInt(m[2], 10));
  }
  return segs;
}

function selectInTextarea(ta, start, end) {
  ta.focus();
  ta.setSelectionRange(start, end);
  
  
  const lineNum = (ta.value.slice(0, start).match(/\n/g) || []).length;
  const totalLines = (ta.value.match(/\n/g) || []).length + 1;
  const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20;
  const scrollTarget = Math.max(0, (lineNum - 5) * lineHeight);
  ta.scrollTop = scrollTarget;
}

function flashSection(section, kind) {
  const className = kind === 'success' ? 'section-flash-success' : 'section-flash-error';
  section.classList.add(className);
  setTimeout(() => section.classList.remove(className), 600);
}

document.getElementById('btn-download-explain').addEventListener('click', () => {
  if (!State.parsedForExplain) return;
  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + fmt().label + ' Explanation</title><style>body{font-family:sans-serif;max-width:800px;margin:24px auto;padding:0 16px;color:#171717}h1{font-size:20px;margin-bottom:8px}h2{font-size:14px;margin-top:24px;color:#7c2d12;font-family:monospace}p{color:#525252;font-size:14px}code{font-family:monospace;font-size:12px;background:#fafafa;padding:2px 6px;border-radius:3px}.example{font-family:monospace;font-size:12px;background:#fafafa;padding:8px;border-radius:4px;white-space:pre-wrap}</style></head><body>' +
    explainOutput.innerHTML +
    '</body></html>';
  downloadBlob(html, fmt().label.toLowerCase() + '-explanation.html', 'text/html');
});

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
      if (inner === '*') {
        tokens.push({ type: 'wildcard' });
      } else if (/^-?\d+$/.test(inner)) {
        tokens.push({ type: 'index', value: parseInt(inner, 10) });
      } else if (/^['"].*['"]$/.test(inner)) {
        const key = inner.slice(1, -1);
        tokens.push({ type: 'key', value: key });
      } else {
        return { ok: false, error: 'Invalid bracket expression "' + inner + '" — expected number, [*], or [\'key\']' };
      }
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
          if (idx >= 0 && idx < v.length) {
            next.push({ path: node.path + '[' + idx + ']', value: v[idx] });
          }
        }
      } else if (tok.type === 'wildcard') {
        if (Array.isArray(v)) {
          v.forEach((item, idx) => {
            next.push({ path: node.path + '[' + idx + ']', value: item });
          });
        } else if (v && typeof v === 'object') {
          
          Object.keys(v).forEach(k => {
            next.push({ path: node.path + '.' + k, value: v[k] });
          });
        }
      }
    }
    current = next;
    if (current.length === 0) break;
  }
  return current;
}

const queryInput = document.getElementById('query-input');
const queryOutput = document.getElementById('query-output');
const queryMeta = document.getElementById('query-meta');
let queryDebounce;

queryInput.addEventListener('input', () => {
  clearTimeout(queryDebounce);
  queryDebounce = setTimeout(runQuery, 100);
});
queryInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') { queryInput.value = ''; runQuery(); }
});

document.getElementById('btn-query-clear').addEventListener('click', () => {
  queryInput.value = '';
  runQuery();
  queryInput.focus();
});

document.getElementById('btn-copy-query-result').addEventListener('click', () => {
  const text = queryOutput.dataset.text;
  if (!text) {
    showStatus('status-explain', 'error', 'Nothing to copy.', 'Run a query first.');
    return;
  }
  copyToClipboard(text).then(() => {
    showStatus('status-explain', 'info', 'Copied query result.', '');
    setTimeout(() => hideStatus('status-explain'), 1500);
  }).catch(e => {
    showStatus('status-explain', 'error', 'Copy failed.', e.message);
  });
});

function runQuery() {
  const q = queryInput.value;
  delete queryOutput.dataset.text;

  if (!q.trim()) {
    queryOutput.innerHTML = '<div class="output-empty">Type a query in the bar above to see live results here.<br>Try: <code>.customer.profile</code> or <code>.employees[*].name</code></div>';
    queryMeta.textContent = '';
    queryMeta.className = 'query-meta';
    return;
  }

  
  if (!State.parsedForExplain) {
    
    try {
      State.parsedForExplain = fmt().parseStrict(explainInput.value);
    } catch (_) {
      try {
        const fx = fmt().autoFix(explainInput.value);
        State.parsedForExplain = fmt().parseStrict(fx.fixed);
      } catch (_) {
        queryOutput.innerHTML = '<div class="output-empty">Parse the input first (click Explain Structure).</div>';
        queryMeta.textContent = 'No data';
        queryMeta.className = 'query-meta no-results';
        return;
      }
    }
  }

  const parsed = parseQuery(q);
  if (!parsed.ok) {
    queryOutput.innerHTML = '<div class="query-error">' + escapeHtml(parsed.error) + '</div>';
    queryMeta.textContent = 'Invalid';
    queryMeta.className = 'query-meta invalid';
    return;
  }

  const results = evaluateQuery(State.parsedForExplain, parsed.tokens);
  renderQueryResults(results);
}

function renderQueryResults(results) {
  queryOutput.innerHTML = '';
  if (results.length === 0) {
    queryOutput.innerHTML = '<div class="output-empty">No matches.<br>Try a different path or check spelling.</div>';
    queryMeta.textContent = '0 results';
    queryMeta.className = 'query-meta no-results';
    return;
  }
  queryMeta.textContent = results.length + ' result' + (results.length === 1 ? '' : 's');
  queryMeta.className = 'query-meta has-results';

  
  if (results.length === 1) {
    queryOutput.dataset.text = formatValueForCopy(results[0].value);
  } else {
    queryOutput.dataset.text = JSON.stringify(results.map(r => ({ path: r.path, value: r.value })), null, 2);
  }

  const container = document.createElement('div');
  container.className = 'query-results';

  results.forEach((r, i) => {
    const item = document.createElement('div');
    item.className = 'query-result-item';

    
    const pathRow = document.createElement('div');
    pathRow.className = 'query-result-path';
    const idxBadge = '<span class="query-result-idx">' + (i + 1) + '</span>';
    const typeBadge = '<span class="type-tag ' + inferType(r.value) + '">' + inferType(r.value) + '</span>';
    pathRow.innerHTML = idxBadge + ' <code class="query-result-path-text">' + escapeHtml(r.path) + '</code> ' + typeBadge;
    item.appendChild(pathRow);

    
    const valBox = document.createElement('div');
    valBox.className = 'query-result-value';
    if (r.value === null) {
      valBox.innerHTML = '<span class="json-null">null</span>';
    } else if (typeof r.value === 'object') {
      const pre = document.createElement('pre');
      pre.className = 'json-view';
      pre.innerHTML = syntaxHighlightJson(JSON.stringify(r.value, null, 2));
      valBox.appendChild(pre);
    } else if (typeof r.value === 'string') {
      valBox.innerHTML = '<span class="json-string">"' + escapeHtml(r.value) + '"</span>';
    } else if (typeof r.value === 'number') {
      valBox.innerHTML = '<span class="json-number">' + r.value + '</span>';
    } else if (typeof r.value === 'boolean') {
      valBox.innerHTML = '<span class="json-boolean">' + r.value + '</span>';
    } else {
      valBox.textContent = String(r.value);
    }
    item.appendChild(valBox);

    container.appendChild(item);
  });

  queryOutput.appendChild(container);
}

function formatValueForCopy(v) {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'object') return JSON.stringify(v, null, 2);
  return String(v);
}

const originalDoExplain = doExplain;

const convertInput = document.getElementById('convert-input');
const convertOutput = document.getElementById('convert-output');
const convertToSelect = document.getElementById('convert-to');

function rebuildConvertOptions() {
  const F = fmt();
  document.getElementById('convert-from-label').textContent = F.label;
  document.getElementById('convert-from-title').textContent = F.label;
  if (convertInput) convertInput.placeholder = F.placeholder;

  
  const others = ['json', 'yaml'].filter(f => f !== State.activeFormat);
  convertToSelect.innerHTML = others.map(f =>
    '<option value="' + f + '">' + Format[f].label + '</option>'
  ).join('');
  document.getElementById('convert-to-title').textContent = Format[others[0]].label;
}
convertToSelect && convertToSelect.addEventListener('change', () => {
  document.getElementById('convert-to-title').textContent = Format[convertToSelect.value].label;
});

document.getElementById('btn-convert').addEventListener('click', () => {
  const text = convertInput.value;
  const F = fmt();
  const targetFmt = Format[convertToSelect.value];

  if (!text.trim()) {
    showStatus('status-convert', 'error', 'No input', 'Paste ' + F.label + ' to convert.');
    return;
  }

  
  let value, notes = [];
  try {
    const r = F.parse(text);
    value = r.value;
    notes = r.notes || [];
  } catch (e) {
    showStatus('status-convert', 'error', 'Could not parse ' + F.label + ' input.', e.message);
    convertOutput.innerHTML = '<div class="output-empty">Nothing to display.</div>';
    return;
  }

  
  let out;
  try {
    out = targetFmt.stringify(value);
  } catch (e) {
    showStatus('status-convert', 'error', 'Could not serialize to ' + targetFmt.label + '.', e.message);
    return;
  }

  
  convertOutput.innerHTML = '';
  const pre = document.createElement('pre');
  pre.className = 'json-view';
  pre.textContent = out;
  if (targetFmt === Format.json) pre.innerHTML = syntaxHighlightJson(out);
  convertOutput.appendChild(pre);

  
  const lines = ['Converted ' + F.label + ' → ' + targetFmt.label + '.'];
  if (notes.length) lines.push('Auto-fix applied:\n' + notes.map(n => '• ' + n).join('\n'));
  showStatus('status-convert', notes.length ? 'warn' : 'success', lines[0], lines.slice(1).join('\n'));

  
  convertOutput.dataset.text = out;
  convertOutput.dataset.ext = targetFmt.ext;
  convertOutput.dataset.mime = targetFmt.mime;
});

document.getElementById('btn-copy-convert-input').addEventListener('click', () => {
  copyToClipboard(convertInput.value).then(() => {
    showStatus('status-convert', 'info', 'Copied input to clipboard.', '');
    setTimeout(() => hideStatus('status-convert'), 1500);
  }).catch(e => {
    showStatus('status-convert', 'error', 'Copy failed.', e.message);
  });
});

document.getElementById('btn-copy-convert-output').addEventListener('click', () => {
  const text = convertOutput.dataset.text;
  if (!text) {
    showStatus('status-convert', 'error', 'Nothing to copy.', 'Convert something first.');
    return;
  }
  copyToClipboard(text).then(() => {
    showStatus('status-convert', 'info', 'Copied output to clipboard.', '');
    setTimeout(() => hideStatus('status-convert'), 1500);
  }).catch(e => {
    showStatus('status-convert', 'error', 'Copy failed.', e.message);
  });
});

document.getElementById('btn-download-convert').addEventListener('click', () => {
  const text = convertOutput.dataset.text;
  if (!text) {
    showStatus('status-convert', 'error', 'Nothing to download.', 'Convert something first.');
    return;
  }
  const ext = convertOutput.dataset.ext || 'txt';
  const mime = convertOutput.dataset.mime || 'text/plain';
  downloadBlob(text, 'converted.' + ext, mime);
  showStatus('status-convert', 'success', 'Downloaded converted.' + ext + '.', '');
  setTimeout(() => hideStatus('status-convert'), 1500);
});

document.getElementById('btn-clear-convert').addEventListener('click', () => {
  convertInput.value = '';
  convertOutput.innerHTML = '<div class="output-empty">Converted result will appear here.</div>';
  delete convertOutput.dataset.text;
  hideStatus('status-convert');
});

document.getElementById('btn-swap-convert').addEventListener('click', () => {
  const out = convertOutput.dataset.text;
  if (!out) {
    showStatus('status-convert', 'error', 'Nothing to swap.', 'Convert something first.');
    return;
  }
  const newFormat = convertToSelect.value;
  
  State.activeFormat = newFormat;
  document.getElementById('active-format').value = newFormat;
  updateFormatLabels();
  
  convertInput.value = out;
  convertOutput.innerHTML = '<div class="output-empty">Converted result will appear here.</div>';
  delete convertOutput.dataset.text;
  showStatus('status-convert', 'info', 'Output moved to input.', 'Active format is now ' + Format[newFormat].label + '. Choose a new target format and click Convert.');
});

updateFormatLabels();

const SAMPLE_JSON = {
  "company": "Acme Corp",
  "founded": 1998,
  "active": true,
  "headquarters": {
    "city": "San Francisco",
    "country": "USA",
    "coordinates": { "lat": 37.7749, "lng": -122.4194 }
  },
  "employees": [
    { "id": 1, "name": "Alice", "role": "Engineer", "skills": ["Python", "Go"], "active": true, "salary": 120000 },
    { "id": 2, "name": "Bob", "role": "Designer", "skills": ["Figma", "CSS"], "active": true, "salary": 95000 },
    { "id": 3, "name": "Charlie", "role": "Manager", "skills": ["Strategy"], "active": false, "salary": 140000 }
  ],
  "projects": [
    {
      "name": "Apollo",
      "status": "active",
      "milestones": [
        { "phase": "design", "done": true, "completed_at": "2024-03-15" },
        { "phase": "build", "done": false, "completed_at": null }
      ]
    }
  ],
  "tags": ["b2b", "saas", "ai"],
  "metadata": null
};

const SAMPLE_CSV = `name,age,city,active,score
Alice,30,Paris,true,87.5
Bob,25,Tokyo,true,92.1
Charlie,35,Berlin,false,76.3
Diana,28,London,true,88.9`;

const SAMPLE_CSV_NESTED = `user.id,user.name,user.email,user.address.city,user.address.country,user.role
101,Alice Smith,alice@example.com,Paris,France,Engineer
102,Bob Chen,bob@example.com,Tokyo,Japan,Designer
103,Charlie Müller,charlie@example.com,Berlin,Germany,Manager`;

const SAMPLE_CSV_WITH_JSON = `id,name,tags,address
1,Alice,"[""admin"",""premium""]","{""city"":""Paris"",""zip"":""75001""}"
2,Bob,"[""user""]","{""city"":""Tokyo"",""zip"":""100-0001""}"
3,Charlie,"[""user"",""beta""]","{""city"":""Berlin"",""zip"":""10115""}"`;

const SAMPLE_JSON_SIMPLE = {
  "name": "Alice",
  "age": 30,
  "active": true,
  "skills": ["Python", "Go", "Rust"]
};

const SAMPLE_JSON_COMPLEX = {
  "transaction_id": "TXN-2026-00098231",
  "timestamp": "2026-05-22T14:48:33Z",
  "customer": {
    "customer_id": 109283,
    "profile": {
      "first_name": "John",
      "last_name": "Anderson",
      "contacts": {
        "emails": [
          { "type": "personal", "value": "john@example.com", "verified": true },
          { "type": "work", "value": "john.a@company.com", "verified": false }
        ],
        "phones": [{ "country_code": "+1", "number": "5550188", "primary": true }]
      },
      "addresses": [{
        "type": "billing",
        "street": "1200 Main St",
        "city": "Ashburn",
        "state": "VA",
        "geo": { "lat": 39.0438, "lng": -77.4874 }
      }]
    }
  },
  "order": {
    "order_id": "ORD-778122",
    "status": "PROCESSING",
    "items": [
      { "sku": "FIBER-1GB", "name": "Fiber 1Gbps", "price": 99.99, "quantity": 1 },
      { "sku": "CAM-4K", "name": "4K Camera", "price": 129.99, "quantity": 2 }
    ]
  },
  "metadata": null
};

const SAMPLE_BROKEN_JSON = `{
  name: 'Acme Corp',
  founded: 1998,
  active: true,
  employees: [
    { id: 1, name: "Alice", role: 'Engineer', },
    { id: 2, name: "Bob", role: 'Designer', }
  ],
  // a stray comment
  tags: ['b2b', "saas",]
}`;

const SAMPLE_YAML = `company: Acme Corp
founded: 1998
active: true
headquarters:
  city: San Francisco
  coordinates:
    lat: 37.7749
    lng: -122.4194
employees:
  - id: 1
    name: Alice
    skills: [Python, Go]
  - id: 2
    name: Bob
    skills:
      - Figma
      - CSS
tags:
  - b2b
  - saas
`;

const HelpSamples = {
  'parse-json': {
    tab: 'json-in', format: 'json',
    load: () => { jsonInput.value = JSON.stringify(SAMPLE_JSON_SIMPLE, null, 2); doParse(false); }
  },
  'parse-complex-json': {
    tab: 'json-in', format: 'json',
    load: () => { jsonInput.value = JSON.stringify(SAMPLE_JSON_COMPLEX, null, 2); doParse(false); }
  },
  'parse-broken-json': {
    tab: 'json-in', format: 'json',
    load: () => { jsonInput.value = SAMPLE_BROKEN_JSON; doParse(true); }
  },
  'parse-yaml': {
    tab: 'json-in', format: 'yaml',
    load: () => { jsonInput.value = SAMPLE_YAML; doParse(false); }
  },
  'csv-simple': {
    tab: 'data-in', format: null,
    load: () => { resetWorkbookState(); dataInput.value = SAMPLE_CSV; convertToJson(); }
  },
  'csv-nested': {
    tab: 'data-in', format: null,
    load: () => { resetWorkbookState(); dataInput.value = SAMPLE_CSV_NESTED; convertToJson(); }
  },
  'csv-with-json-cells': {
    tab: 'data-in', format: null,
    load: () => { resetWorkbookState(); dataInput.value = SAMPLE_CSV_WITH_JSON; convertToJson(); }
  },
  'explain-json': {
    tab: 'explain', format: 'json',
    load: () => { explainInput.value = JSON.stringify(SAMPLE_JSON_COMPLEX, null, 2); doExplain(); }
  },
  'explain-yaml': {
    tab: 'explain', format: 'yaml',
    load: () => { explainInput.value = SAMPLE_YAML; doExplain(); }
  },
  'convert-json-yaml': {
    tab: 'convert', format: 'json',
    load: () => {
      convertInput.value = JSON.stringify(SAMPLE_JSON, null, 2);
      
      const toSel = document.getElementById('convert-to');
      if (toSel && [...toSel.options].some(o => o.value === 'yaml')) toSel.value = 'yaml';
      document.getElementById('convert-to-title').textContent = 'YAML';
      document.getElementById('btn-convert').click();
    }
  },
  'convert-yaml-json': {
    tab: 'convert', format: 'yaml',
    load: () => {
      convertInput.value = SAMPLE_YAML;
      const toSel = document.getElementById('convert-to');
      if (toSel && [...toSel.options].some(o => o.value === 'json')) toSel.value = 'json';
      document.getElementById('convert-to-title').textContent = 'JSON';
      document.getElementById('btn-convert').click();
    }
  },
  'search-demo': {
    tab: 'explain', format: 'json',
    load: () => {
      explainInput.value = JSON.stringify(SAMPLE_JSON_COMPLEX, null, 2);
      doExplain();
      setTimeout(() => {
        const searchInput = document.getElementById('key-search-input');
        if (searchInput) {
          searchInput.value = 'email';
          searchInput.dispatchEvent(new Event('input'));
          searchInput.focus();
        }
      }, 100);
    }
  },
  'schema-generate': {
    tab: 'schema', format: 'json',
    load: () => {
      document.getElementById('schema-mode').value = 'generate';
      updateSchemaMode();
      schemaInput1.value = JSON.stringify({
        id: 42,
        name: 'Alice Smith',
        email: 'alice@example.com',
        active: true,
        created_at: '2026-05-22T14:48:33Z',
        score: 87.5,
        tags: ['admin', 'beta'],
        address: { city: 'Paris', country: 'France', zip: '75001' }
      }, null, 2);
      document.getElementById('btn-schema-generate').click();
    }
  },
  'schema-validate': {
    tab: 'schema', format: 'json',
    load: () => {
      document.getElementById('schema-mode').value = 'validate';
      updateSchemaMode();
      schemaInput1.value = JSON.stringify({
        id: 'not-a-number',
        email: 'not an email',
        age: 200
      }, null, 2);
      schemaInput2.value = JSON.stringify({
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        required: ['id', 'email', 'age'],
        properties: {
          id: { type: 'integer', minimum: 1 },
          email: { type: 'string', format: 'email' },
          age: { type: 'integer', minimum: 0, maximum: 150 }
        }
      }, null, 2);
      setTimeout(() => document.getElementById('btn-schema-validate').click(), 50);
    }
  },
  'schema-mock': {
    tab: 'schema', format: 'json',
    load: () => {
      document.getElementById('schema-mode').value = 'generate';
      updateSchemaMode();
      schemaInput1.value = JSON.stringify({
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        required: ['id', 'name', 'email'],
        properties: {
          id: { type: 'integer', minimum: 1, maximum: 9999 },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          active: { type: 'boolean' },
          created_at: { type: 'string', format: 'date-time' },
          role: { type: 'string', enum: ['admin', 'user', 'editor'] },
          tags: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 }
        }
      }, null, 2);
      document.getElementById('schema-mock-count').value = '10';
      setTimeout(() => document.getElementById('btn-schema-mock').click(), 50);
    }
  },
  'diff-demo': {
    tab: 'diff', format: 'json',
    load: () => {
      diffInputA.value = JSON.stringify({
        id: 1,
        name: 'Alice',
        active: true,
        roles: ['admin'],
        address: { city: 'Paris', zip: '75001' }
      }, null, 2);
      diffInputB.value = JSON.stringify({
        id: 1,
        name: 'Alice Smith',
        active: true,
        roles: ['admin', 'editor'],
        address: { city: 'Paris', zip: '75002', country: 'France' }
      }, null, 2);
      setTimeout(() => document.getElementById('btn-diff-compare').click(), 50);
    }
  },
  'diff-arrays': {
    tab: 'diff', format: 'json',
    load: () => {
      diffInputA.value = JSON.stringify({ items: ['apple', 'banana', 'cherry'] }, null, 2);
      diffInputB.value = JSON.stringify({ items: ['banana', 'cherry', 'apple', 'date'] }, null, 2);
      document.getElementById('diff-ignore-order').checked = true;
      setTimeout(() => document.getElementById('btn-diff-compare').click(), 50);
    }
  },
};

function switchToTab(tabName) {
  
  const tab = document.querySelector('.tab[data-tab="' + tabName + '"]');
  if (tab) { tab.click(); return; }
  
  const panel = document.getElementById('panel-' + tabName);
  if (panel) {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    panel.classList.add('active');
  }
}

document.getElementById('btn-help').addEventListener('click', () => {
  switchToTab('help');
  
  if (window.matchMedia('(max-width: 768px)').matches) {
    document.querySelectorAll('#panel-help .help-section[data-collapsible]').forEach(s => {
      s.classList.add('collapsed');
      const hdr = s.querySelector('.help-section-header');
      if (hdr) hdr.setAttribute('aria-expanded', 'false');
    });
  }
});

document.getElementById('panel-help').addEventListener('click', e => {
  
  const headerBtn = e.target.closest('.help-section-header');
  if (headerBtn) {
    const section = headerBtn.closest('.help-section');
    if (section) {
      section.classList.toggle('collapsed');
      headerBtn.setAttribute('aria-expanded', section.classList.contains('collapsed') ? 'false' : 'true');
    }
    return;
  }

  
  const btn = e.target.closest('[data-help-load]');
  if (!btn) return;
  const key = btn.dataset.helpLoad;
  const sample = HelpSamples[key];
  if (!sample) return;

  
  if (sample.format && sample.format !== State.activeFormat) {
    const fmtSel = document.getElementById('active-format');
    fmtSel.value = sample.format;
    State.activeFormat = sample.format;
    updateFormatLabels();
  }

  
  switchToTab(sample.tab);

  
  setTimeout(() => {
    try { sample.load(); }
    catch (err) { console.error('Sample load failed:', err); }
  }, 50);
});

document.getElementById('btn-help-expand-all').addEventListener('click', () => {
  document.querySelectorAll('#panel-help .help-section[data-collapsible]').forEach(s => {
    s.classList.remove('collapsed');
    const hdr = s.querySelector('.help-section-header');
    if (hdr) hdr.setAttribute('aria-expanded', 'true');
  });
});
document.getElementById('btn-help-collapse-all').addEventListener('click', () => {
  document.querySelectorAll('#panel-help .help-section[data-collapsible]').forEach(s => {
    s.classList.add('collapsed');
    const hdr = s.querySelector('.help-section-header');
    if (hdr) hdr.setAttribute('aria-expanded', 'false');
  });
});

jsonInput.addEventListener('paste', () => {
  setTimeout(() => {
    if (jsonInput.value.length < 200000) doParse(false);
  }, 50);
});

const DEV_CODE_HASH = 'e4bda4e74dd0194e6b4cd0b2cf6e8ffe7983b4f8559888c61c91e4377ed0d7b7';
const DEV_SETTINGS_KEY = 'jsonpi.devSettings';
const DEV_UNLOCK_KEY = 'jsonpi.devUnlocked';

const DEFAULT_SETTINGS = {
  theme: 'light',
  'tab.json-in': true,
  'tab.data-in': true,
  'tab.explain': true,
  'tab.convert': true,
  'tab.schema': true,
  'tab.diff': true,
  'feature.autofix': true,
  'feature.types': true,
  'feature.pdf': true,
  'feature.multisheet': true,
  'feature.find': true,
  'feature.query': true,
  'ui.playground': true,
  'ui.subtitle': true,
  'ui.footer-notice': true,
  'ui.footer': true,
};

let devSettings = loadDevSettings();

/* Dev unlock expires after 24 hours regardless of browser session state.
   We store a timestamp (not a boolean) so stale unlocks always expire.
   This prevents the "Contact History stays visible even after browser close" bug
   that can happen because sessionStorage can persist longer than expected. */
const DEV_UNLOCK_TTL_MS = 24 * 60 * 60 * 1000;
function isDevUnlockValid() {
  try {
    const raw = sessionStorage.getItem(DEV_UNLOCK_KEY);
    if (!raw) return false;
    const ts = parseInt(raw, 10);
    if (!Number.isFinite(ts)) return false;
    if (Date.now() - ts > DEV_UNLOCK_TTL_MS) {
      sessionStorage.removeItem(DEV_UNLOCK_KEY);
      return false;
    }
    return true;
  } catch (_) { return false; }
}
let devUnlocked = isDevUnlockValid();

function loadDevSettings() {
  try {
    const stored = localStorage.getItem(DEV_SETTINGS_KEY);
    if (!stored) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(stored);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveDevSettings() {
  try { localStorage.setItem(DEV_SETTINGS_KEY, JSON.stringify(devSettings)); }
  catch (_) {}
}

async function sha256(text) {
  const buf = new TextEncoder().encode(text);
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function setShown(selector, shown) {
  document.querySelectorAll(selector).forEach(el => {
    el.classList.toggle('dev-hidden', !shown);
  });
}

function applyDevSettings() {
  document.documentElement.classList.toggle('theme-dark', devSettings.theme === 'dark');
  const themeSel = document.getElementById('dev-theme');
  if (themeSel) themeSel.value = devSettings.theme;

  setShown('.tab[data-tab="json-in"]',  devSettings['tab.json-in']);
  setShown('.tab[data-tab="data-in"]',  devSettings['tab.data-in']);
  setShown('.tab[data-tab="explain"]',  devSettings['tab.explain']);
  setShown('.tab[data-tab="convert"]',  devSettings['tab.convert']);
  setShown('.tab[data-tab="schema"]',   devSettings['tab.schema']);
  setShown('.tab[data-tab="diff"]',     devSettings['tab.diff']);

  setShown('#btn-autofix',          devSettings['feature.autofix']);
  setShown('.types-card',           devSettings['feature.types']);
  setShown('#file-json',            devSettings['feature.pdf']);
  if (!devSettings['feature.pdf']) {
    const dz = document.getElementById('dropzone-json');
    if (dz) dz.classList.add('dev-hidden');
  } else {
    const dz = document.getElementById('dropzone-json');
    if (dz) dz.classList.remove('dev-hidden');
  }
  setShown('#sheet-selector-bar',   devSettings['feature.multisheet']);
  setShown('#key-search-bar',       devSettings['feature.find']);
  setShown('#query-bar',            devSettings['feature.query']);
  setShown('#panel-explain .workspace > .card:nth-child(3)', devSettings['feature.query']);

  setShown('#btn-help',             devSettings['ui.playground']);
  setShown('#subtitle-format',      devSettings['ui.subtitle']);
  const subtitleParent = document.querySelector('.brand .subtitle');
  if (subtitleParent) subtitleParent.classList.toggle('dev-hidden', !devSettings['ui.subtitle']);
  setShown('.footer-notice',        devSettings['ui.footer-notice']);
  setShown('footer',                devSettings['ui.footer']);

  if (devSettings.theme === 'dark') {
    document.documentElement.classList.add('theme-dark');
  } else {
    document.documentElement.classList.remove('theme-dark');
  }

  syncDevPanelCheckboxes();
}

function syncDevPanelCheckboxes() {
  document.querySelectorAll('[data-dev-setting]').forEach(cb => {
    const key = cb.dataset.devSetting;
    if (key in devSettings) cb.checked = !!devSettings[key];
  });
}

document.addEventListener('change', e => {
  const target = e.target;
  if (target && target.dataset && target.dataset.devSetting) {
    devSettings[target.dataset.devSetting] = target.checked;
    saveDevSettings();
    applyDevSettings();
  }
  if (target && target.id === 'dev-theme') {
    devSettings.theme = target.value;
    saveDevSettings();
    applyDevSettings();
  }
});

const devGateBtn      = document.getElementById('btn-dev-gate');
const devGateModal    = document.getElementById('dev-gate-modal');
const devGateInput    = document.getElementById('dev-gate-input');
const devGateSubmit   = document.getElementById('dev-gate-submit');
const devGateCancel   = document.getElementById('dev-gate-cancel');
const devGateMessage  = document.getElementById('dev-gate-message');

function openDevGate() {
  if (devUnlocked) {
    switchToTab('dev');
    return;
  }
  devGateModal.style.display = 'flex';
  devGateInput.value = '';
  devGateMessage.textContent = '';
  devGateMessage.className = '';
  setTimeout(() => devGateInput.focus(), 30);
}

function closeDevGate() {
  devGateModal.style.display = 'none';
}

async function submitDevGate() {
  const code = devGateInput.value.trim();
  if (!code) {
    devGateMessage.textContent = 'Enter a code.';
    devGateMessage.className = 'error';
    return;
  }
  try {
    const hash = await sha256(code);
    if (hash === DEV_CODE_HASH) {
      devUnlocked = true;
      sessionStorage.setItem(DEV_UNLOCK_KEY, String(Date.now()));
      devGateMessage.textContent = '✓ Unlocked.';
      devGateMessage.className = 'success';
      devGateBtn.classList.add('unlocked');
      devGateBtn.title = 'Developer panel (unlocked)';
      showContactHistoryTab(true);
      setTimeout(() => {
        closeDevGate();
        switchToTab('dev');
      }, 350);
    } else {
      devGateMessage.textContent = '✗ Incorrect code.';
      devGateMessage.className = 'error';
      devGateInput.value = '';
      devGateInput.focus();
    }
  } catch (e) {
    devGateMessage.textContent = 'Error: ' + e.message;
    devGateMessage.className = 'error';
  }
}

devGateBtn.addEventListener('click', openDevGate);
devGateSubmit.addEventListener('click', submitDevGate);
devGateCancel.addEventListener('click', closeDevGate);
devGateInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); submitDevGate(); }
  else if (e.key === 'Escape') closeDevGate();
});
devGateModal.addEventListener('click', e => {
  if (e.target === devGateModal) closeDevGate();
});

document.getElementById('btn-dev-reset').addEventListener('click', () => {
  if (!confirm('Reset all developer settings to defaults? This will undo every toggle change.')) return;
  devSettings = { ...DEFAULT_SETTINGS };
  saveDevSettings();
  applyDevSettings();
});

document.getElementById('btn-dev-logout').addEventListener('click', () => {
  devUnlocked = false;
  sessionStorage.removeItem(DEV_UNLOCK_KEY);
  localStorage.removeItem('jsonpi.adminToken');
  devGateBtn.classList.remove('unlocked');
  devGateBtn.title = 'Developer access';
  showContactHistoryTab(false);
  switchToTab('json-in');
});

if (devUnlocked) {
  devGateBtn.classList.add('unlocked');
  devGateBtn.title = 'Developer panel (unlocked)';
  showContactHistoryTab(true);
}

const DEV_DOCS_BASE_URL = 'https://json-pi.com/api';

const DEV_DOCS_ENDPOINTS = [
  {
    id: 'parse',
    method: 'POST',
    path: '/parse',
    summary: 'Parse a JSON or YAML document (with optional auto-fix).',
    description: 'Accepts raw text in JSON or YAML format. Returns the parsed object. If auto_fix is enabled, common syntactic errors are repaired transparently and the repairs applied are reported in the response.',
    params: [
      { name: 'text', type: 'string', required: true, desc: 'The raw document text to parse.' },
      { name: 'format', type: 'string', required: false, desc: '"json" or "yaml". Defaults to "json".' },
      { name: 'auto_fix', type: 'boolean', required: false, desc: 'Repair malformed input before parsing. Defaults to true.' },
    ],
    exampleRequest: {
      text: '{name: "Acme", active: true,}',
      format: 'json',
      auto_fix: true,
    },
    exampleResponse: {
      ok: true,
      value: { name: 'Acme', active: true },
      repairs: [
        'Quoted unquoted keys.',
        'Removed trailing commas.',
      ],
    },
  },
  {
    id: 'convert',
    method: 'POST',
    path: '/convert',
    summary: 'Convert a document between JSON and YAML.',
    description: 'Reads the input in one format and re-emits it in another. Auto-fix runs by default so malformed input still converts cleanly.',
    params: [
      { name: 'text', type: 'string', required: true, desc: 'The source document text.' },
      { name: 'from', type: 'string', required: true, desc: '"json" or "yaml" — the input format.' },
      { name: 'to', type: 'string', required: true, desc: '"json" or "yaml" — the target format.' },
      { name: 'auto_fix', type: 'boolean', required: false, desc: 'Repair malformed input. Defaults to true.' },
    ],
    exampleRequest: {
      text: '{"name": "Acme", "tags": ["b2b", "saas"]}',
      from: 'json',
      to: 'yaml',
    },
    exampleResponse: {
      ok: true,
      result: 'name: Acme\ntags:\n  - b2b\n  - saas\n',
    },
  },
  {
    id: 'explain',
    method: 'POST',
    path: '/explain',
    summary: 'Get a structural breakdown of a document.',
    description: 'Returns every key path with its inferred type, length (for arrays/objects), and an example value. Useful for understanding the shape of unfamiliar data.',
    params: [
      { name: 'text', type: 'string', required: true, desc: 'The document text.' },
      { name: 'format', type: 'string', required: false, desc: '"json" or "yaml". Defaults to "json".' },
      { name: 'depth', type: 'string', required: false, desc: '"overview" (3 levels) or "full" (50 levels). Defaults to "full".' },
    ],
    exampleRequest: {
      text: '{"customer": {"id": 1, "name": "Alice"}, "active": true}',
      format: 'json',
    },
    exampleResponse: {
      ok: true,
      entries: [
        { path: '$.customer',      type: 'object',  length: 2 },
        { path: '$.customer.id',   type: 'integer', example: 1 },
        { path: '$.customer.name', type: 'string',  example: 'Alice' },
        { path: '$.active',        type: 'boolean', example: true },
      ],
    },
  },
  {
    id: 'query',
    method: 'POST',
    path: '/query',
    summary: 'Run a JSONPath-style query against a document.',
    description: 'Supports dot-notation paths, array indices, and the [*] wildcard. Returns every matching value with its full path.',
    params: [
      { name: 'text', type: 'string', required: true, desc: 'The document text.' },
      { name: 'format', type: 'string', required: false, desc: '"json" or "yaml". Defaults to "json".' },
      { name: 'query', type: 'string', required: true, desc: 'The JSONPath query, e.g. ".employees[*].name".' },
    ],
    exampleRequest: {
      text: '{"employees": [{"name": "Alice"}, {"name": "Bob"}]}',
      query: '.employees[*].name',
    },
    exampleResponse: {
      ok: true,
      results: [
        { path: '$.employees[0].name', value: 'Alice' },
        { path: '$.employees[1].name', value: 'Bob' },
      ],
    },
  },
  {
    id: 'types',
    method: 'POST',
    path: '/types',
    summary: 'Infer the type of every field in a document.',
    description: 'Walks the parsed object and returns a parallel structure where each primitive is replaced by its detected type — including specialized types like datetime, email, url, uuid, phone, and ipv4.',
    params: [
      { name: 'text', type: 'string', required: true, desc: 'The document text.' },
      { name: 'format', type: 'string', required: false, desc: '"json" or "yaml". Defaults to "json".' },
    ],
    exampleRequest: {
      text: '{"id": 42, "email": "alice@example.com", "created_at": "2026-05-22T14:48:33Z"}',
    },
    exampleResponse: {
      ok: true,
      types: {
        id: 'integer',
        email: 'email',
        created_at: 'datetime',
      },
      summary: { integer: 1, email: 1, datetime: 1 },
    },
  },
  {
    id: 'schema',
    method: 'POST',
    path: '/schema',
    summary: 'Generate a JSON Schema (Draft-07) from sample data.',
    description: 'Walks the input document and produces a JSON Schema that describes its shape — types, required fields, item schemas for arrays, and detected string formats (date, email, uuid, etc.).',
    params: [
      { name: 'text', type: 'string', required: true, desc: 'Sample document text to infer the schema from.' },
      { name: 'format', type: 'string', required: false, desc: '"json" or "yaml". Defaults to "json".' },
    ],
    exampleRequest: {
      text: '{"id": 1, "email": "a@b.com", "active": true}',
    },
    exampleResponse: {
      ok: true,
      schema: {
        '$schema': 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          id: { type: 'integer' },
          email: { type: 'string', format: 'email' },
          active: { type: 'boolean' },
        },
        required: ['id', 'email', 'active'],
      },
    },
  },
  {
    id: 'validate',
    method: 'POST',
    path: '/validate',
    summary: 'Validate a document against a JSON Schema.',
    description: 'Returns ok=true with no errors when the document is valid. When invalid, returns an array of errors with their paths and human-readable messages. Supports a useful subset of Draft-07.',
    params: [
      { name: 'data', type: 'object|array', required: true, desc: 'The parsed document to validate.' },
      { name: 'schema', type: 'object', required: true, desc: 'The JSON Schema to validate against.' },
    ],
    exampleRequest: {
      data: { id: 'not-a-number', email: 'bad' },
      schema: {
        type: 'object',
        required: ['id', 'email'],
        properties: {
          id: { type: 'integer' },
          email: { type: 'string', format: 'email' },
        },
      },
    },
    exampleResponse: {
      ok: true,
      valid: false,
      errors: [
        { path: '$.id', message: 'Expected type integer, got string' },
        { path: '$.email', message: 'String does not match format: email' },
      ],
    },
  },
  {
    id: 'mock',
    method: 'POST',
    path: '/mock',
    summary: 'Generate mock data matching a JSON Schema.',
    description: 'Produces 1 to 1000 fake records that satisfy the given schema. Uses smart key-based heuristics (a property called "email" becomes an email string; "first_name" becomes a name).',
    params: [
      { name: 'schema', type: 'object', required: true, desc: 'The JSON Schema to generate records for.' },
      { name: 'count', type: 'integer', required: false, desc: 'Number of records (1-1000, default 1).' },
    ],
    exampleRequest: {
      schema: {
        type: 'object',
        properties: {
          id: { type: 'integer', minimum: 1, maximum: 100 },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
        },
        required: ['id', 'name', 'email'],
      },
      count: 3,
    },
    exampleResponse: {
      ok: true,
      records: [
        { id: 47, name: 'Alice Smith', email: 'alice.smith@example.com' },
        { id: 12, name: 'Bob Chen', email: 'bob.chen@acme.io' },
        { id: 89, name: 'Diana Müller', email: 'diana.muller@mailcorp.net' },
      ],
    },
  },
  {
    id: 'diff',
    method: 'POST',
    path: '/diff',
    summary: 'Compare two documents and return structural differences.',
    description: 'Deep-diffs two JSON or YAML documents and returns lists of added, removed, and changed paths. Optionally ignore array order when comparing.',
    params: [
      { name: 'a', type: 'string', required: true, desc: 'The original document text.' },
      { name: 'b', type: 'string', required: true, desc: 'The modified document text.' },
      { name: 'format', type: 'string', required: false, desc: '"json" or "yaml". Defaults to "json".' },
      { name: 'ignore_order', type: 'boolean', required: false, desc: 'Compare arrays without regard to item order. Defaults to false.' },
    ],
    exampleRequest: {
      a: '{"id":1,"name":"Alice","roles":["admin"]}',
      b: '{"id":1,"name":"Alice Smith","roles":["admin","editor"]}',
    },
    exampleResponse: {
      ok: true,
      added:   [{ path: '$.roles[1]', value: 'editor' }],
      removed: [],
      changed: [{ path: '$.name', oldValue: 'Alice', newValue: 'Alice Smith' }],
      unchanged_count: 2,
    },
  },
];

const LANG_LABELS = {
  python: 'Python',
  javascript: 'JavaScript',
  curl: 'cURL',
  go: 'Go',
  ruby: 'Ruby',
  php: 'PHP',
  java: 'Java',
};

function buildSnippet(lang, endpoint) {
  const url = DEV_DOCS_BASE_URL + endpoint.path;
  const body = JSON.stringify(endpoint.exampleRequest, null, 2);

  if (lang === 'python') {
    return 'import requests\n\nresponse = requests.post(\n    "' + url + '",\n    json=' + pyDictRepr(endpoint.exampleRequest, 1) + ',\n    timeout=30,\n)\nresponse.raise_for_status()\ndata = response.json()\nprint(data)';
  }

  if (lang === 'javascript') {
    return 'const response = await fetch("' + url + '", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify(' + body.split('\n').map((l, i) => i === 0 ? l : '  ' + l).join('\n') + '),\n});\n\nif (!response.ok) {\n  throw new Error(`HTTP ${response.status}: ${await response.text()}`);\n}\nconst data = await response.json();\nconsole.log(data);';
  }

  if (lang === 'curl') {
    const escaped = body.replace(/'/g, "'\\''");
    return 'curl -X POST "' + url + '" \\\n  -H "Content-Type: application/json" \\\n  -d \'' + escaped + '\'';
  }

  if (lang === 'go') {
    return 'package main\n\nimport (\n\t"bytes"\n\t"encoding/json"\n\t"fmt"\n\t"net/http"\n)\n\nfunc main() {\n\tpayload, _ := json.Marshal(map[string]interface{}' + formatGoMap(endpoint.exampleRequest, 1) + ')\n\tresp, err := http.Post("' + url + '", "application/json", bytes.NewBuffer(payload))\n\tif err != nil { panic(err) }\n\tdefer resp.Body.Close()\n\n\tvar result map[string]interface{}\n\tjson.NewDecoder(resp.Body).Decode(&result)\n\tfmt.Println(result)\n}';
  }

  if (lang === 'ruby') {
    return 'require "net/http"\nrequire "json"\nrequire "uri"\n\nuri = URI("' + url + '")\nhttp = Net::HTTP.new(uri.host, uri.port)\nhttp.use_ssl = true\n\nrequest = Net::HTTP::Post.new(uri.path, "Content-Type" => "application/json")\nrequest.body = ' + rubyHashRepr(endpoint.exampleRequest, 1) + '.to_json\n\nresponse = http.request(request)\nputs JSON.parse(response.body)';
  }

  if (lang === 'php') {
    return '<?php\n$payload = json_encode(' + formatPhpArray(endpoint.exampleRequest, 1) + ');\n\n$ch = curl_init("' + url + '");\ncurl_setopt($ch, CURLOPT_POST, true);\ncurl_setopt($ch, CURLOPT_POSTFIELDS, $payload);\ncurl_setopt($ch, CURLOPT_HTTPHEADER, ["Content-Type: application/json"]);\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\n\n$response = curl_exec($ch);\ncurl_close($ch);\n\n$data = json_decode($response, true);\nprint_r($data);';
  }

  if (lang === 'java') {
    const escapedBody = body.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    return 'import java.net.URI;\nimport java.net.http.HttpClient;\nimport java.net.http.HttpRequest;\nimport java.net.http.HttpResponse;\n\npublic class JsonPiClient {\n  public static void main(String[] args) throws Exception {\n    HttpClient client = HttpClient.newHttpClient();\n    String payload = "' + escapedBody + '";\n\n    HttpRequest request = HttpRequest.newBuilder()\n        .uri(URI.create("' + url + '"))\n        .header("Content-Type", "application/json")\n        .POST(HttpRequest.BodyPublishers.ofString(payload))\n        .build();\n\n    HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());\n    System.out.println(response.body());\n  }\n}';
  }

  return '// not yet implemented';
}

function pyDictRepr(obj, depth) {
  return formatLangValue(obj, { quote: '"', bool: v => v ? 'True' : 'False', nil: 'None', keyQuote: '"' }, depth);
}
function rubyHashRepr(obj, depth) {
  return formatLangValue(obj, { quote: '"', bool: v => v ? 'true' : 'false', nil: 'nil', keyQuote: '"', rocket: true }, depth);
}

function formatLangValue(v, opts, depth) {
  depth = depth || 0;
  const pad = '    '.repeat(depth);
  const innerPad = '    '.repeat(depth + 1);
  if (v === null || v === undefined) return opts.nil;
  if (typeof v === 'boolean') return opts.bool(v);
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return opts.quote + v.replace(new RegExp(opts.quote, 'g'), '\\' + opts.quote) + opts.quote;
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return '[\n' + v.map(item => innerPad + formatLangValue(item, opts, depth + 1)).join(',\n') + '\n' + pad + ']';
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 0) return '{}';
    const sep = opts.rocket ? ' => ' : ': ';
    return '{\n' + keys.map(k =>
      innerPad + opts.keyQuote + k + opts.keyQuote + sep + formatLangValue(v[k], opts, depth + 1)
    ).join(',\n') + '\n' + pad + '}';
  }
  return String(v);
}

function formatPhpArray(v, depth) {
  depth = depth || 0;
  const pad = '    '.repeat(depth);
  const innerPad = '    '.repeat(depth + 1);
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return '"' + v.replace(/"/g, '\\"') + '"';
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return '[\n' + v.map(item => innerPad + formatPhpArray(item, depth + 1)).join(',\n') + '\n' + pad + ']';
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 0) return '[]';
    return '[\n' + keys.map(k =>
      innerPad + '"' + k + '" => ' + formatPhpArray(v[k], depth + 1)
    ).join(',\n') + '\n' + pad + ']';
  }
  return String(v);
}

function formatGoMap(v, depth) {
  depth = depth || 0;
  const pad = '\t'.repeat(depth);
  const innerPad = '\t'.repeat(depth + 1);
  if (v === null) return 'nil';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return '"' + v.replace(/"/g, '\\"') + '"';
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]interface{}{}';
    return '[]interface{}{\n' + v.map(item => innerPad + formatGoMap(item, depth + 1)).join(',\n') + ',\n' + pad + '}';
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 0) return '{}';
    return '{\n' + keys.map(k =>
      innerPad + '"' + k + '": ' + formatGoMap(v[k], depth + 1)
    ).join(',\n') + ',\n' + pad + '}';
  }
  return String(v);
}

let currentDocsLang = 'python';

function renderDocsEndpoints() {
  const container = document.querySelector('#panel-developers .docs-endpoints');
  if (!container) return;
  container.innerHTML = DEV_DOCS_ENDPOINTS.map((ep, i) => buildEndpointCard(ep, i)).join('');
  document.querySelectorAll('#panel-developers .docs-endpoint').forEach((card, idx) => {
    if (idx !== 0) card.classList.add('collapsed');
  });
}

function buildEndpointCard(ep, idx) {
  const params = ep.params.map(p =>
    '<tr><td><code>' + p.name + '</code>' +
    (p.required ? '<span class="docs-param-required">required</span>' : '<span class="docs-param-optional">optional</span>') +
    '</td><td><code>' + p.type + '</code></td><td>' + escapeHtml(p.desc) + '</td></tr>'
  ).join('');

  const snippet = escapeHtml(buildSnippet(currentDocsLang, ep));
  const responseExample = escapeHtml(JSON.stringify(ep.exampleResponse, null, 2));

  return '<article class="docs-endpoint" data-endpoint-id="' + ep.id + '">' +
    '<button class="docs-endpoint-header" type="button" aria-expanded="' + (idx === 0 ? 'true' : 'false') + '">' +
      '<span class="docs-chevron">▾</span>' +
      '<span class="docs-method ' + ep.method.toLowerCase() + '">' + ep.method + '</span>' +
      '<span class="docs-endpoint-path">' + escapeHtml(ep.path) + '</span>' +
      '<span class="docs-endpoint-desc">' + escapeHtml(ep.summary) + '</span>' +
    '</button>' +
    '<div class="docs-endpoint-body">' +
      '<h4>Description</h4>' +
      '<p>' + escapeHtml(ep.description) + '</p>' +
      '<h4>Parameters</h4>' +
      '<table class="docs-params-table">' +
        '<thead><tr><th>Name</th><th>Type</th><th>Description</th></tr></thead>' +
        '<tbody>' + params + '</tbody>' +
      '</table>' +
      '<h4 class="docs-snippet-header">Request example (' + LANG_LABELS[currentDocsLang] + ')</h4>' +
      '<pre class="docs-code"><button class="docs-code-copy" data-copy-target="snippet-' + ep.id + '">Copy</button><span class="docs-code-text" id="snippet-' + ep.id + '">' + snippet + '</span></pre>' +
      '<h4>Response example</h4>' +
      '<pre class="docs-code"><button class="docs-code-copy" data-copy-target="response-' + ep.id + '">Copy</button><span class="docs-code-text" id="response-' + ep.id + '">' + responseExample + '</span></pre>' +
    '</div>' +
  '</article>';
}

function reRenderSnippetsForLang() {
  document.querySelectorAll('#panel-developers .docs-endpoint').forEach(card => {
    const id = card.dataset.endpointId;
    const ep = DEV_DOCS_ENDPOINTS.find(e => e.id === id);
    if (!ep) return;
    const span = card.querySelector('#snippet-' + ep.id);
    if (span) span.textContent = buildSnippet(currentDocsLang, ep);
    const langHeader = card.querySelector('.docs-snippet-header');
    if (langHeader) langHeader.textContent = 'Request example (' + LANG_LABELS[currentDocsLang] + ')';
  });
}

document.querySelectorAll('.docs-lang').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.docs-lang').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    currentDocsLang = b.dataset.lang;
    reRenderSnippetsForLang();
  });
});

const panelDevelopers = document.getElementById('panel-developers');
panelDevelopers.addEventListener('click', e => {
  const header = e.target.closest('.docs-endpoint-header');
  if (header) {
    const card = header.closest('.docs-endpoint');
    if (card) {
      card.classList.toggle('collapsed');
      header.setAttribute('aria-expanded', card.classList.contains('collapsed') ? 'false' : 'true');
    }
    return;
  }
  const copyBtn = e.target.closest('.docs-code-copy');
  if (copyBtn) {
    const targetId = copyBtn.dataset.copyTarget;
    const target = document.getElementById(targetId);
    if (target) {
      copyToClipboard(target.textContent).then(() => {
        copyBtn.classList.add('copied');
        const oldText = copyBtn.textContent;
        copyBtn.textContent = '✓ Copied';
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.textContent = oldText;
        }, 1500);
      }).catch(() => {});
    }
  }
});

document.getElementById('btn-docs-expand-all').addEventListener('click', () => {
  document.querySelectorAll('#panel-developers .docs-endpoint').forEach(card => {
    card.classList.remove('collapsed');
    const hdr = card.querySelector('.docs-endpoint-header');
    if (hdr) hdr.setAttribute('aria-expanded', 'true');
  });
});

document.getElementById('btn-docs-collapse-all').addEventListener('click', () => {
  document.querySelectorAll('#panel-developers .docs-endpoint').forEach(card => {
    card.classList.add('collapsed');
    const hdr = card.querySelector('.docs-endpoint-header');
    if (hdr) hdr.setAttribute('aria-expanded', 'false');
  });
});

document.getElementById('btn-developers').addEventListener('click', () => {
  switchToTab('developers');
  if (window.matchMedia('(max-width: 768px)').matches) {
    document.querySelectorAll('#panel-developers .docs-endpoint').forEach((card, idx) => {
      if (idx === 0) {
        card.classList.remove('collapsed');
        const hdr = card.querySelector('.docs-endpoint-header');
        if (hdr) hdr.setAttribute('aria-expanded', 'true');
      } else {
        card.classList.add('collapsed');
        const hdr = card.querySelector('.docs-endpoint-header');
        if (hdr) hdr.setAttribute('aria-expanded', 'false');
      }
    });
  }
});

renderDocsEndpoints();

/* ============================================================
   HEADER MENU TOGGLE — Playground + Developers shown/hidden via ☰
   Default: collapsed on mobile (≤768px), expanded on desktop.
============================================================ */
(function setupHeaderMenu() {
  const menu = document.getElementById('header-menu');
  const toggle = document.getElementById('btn-menu-toggle');
  if (!menu || !toggle) return;

  const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

  function setExpanded(expanded) {
    menu.classList.toggle('collapsed', !expanded);
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  /* Default: collapsed on mobile, expanded on desktop. Toggle is always visible
     so users can hide the menu on desktop too if they prefer the minimal look. */
  setExpanded(!isMobile());

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    setExpanded(!expanded);
  });

  /* After picking Playground or Developers on mobile, auto-collapse for compactness.
     On desktop we leave the menu open since the user explicitly toggled it. */
  menu.addEventListener('click', e => {
    if (isMobile() && e.target.closest('button')) {
      setExpanded(false);
    }
  });

  /* When viewport crosses the mobile/desktop boundary, reset to the new default. */
  let wasMobile = isMobile();
  window.addEventListener('resize', () => {
    const nowMobile = isMobile();
    if (nowMobile !== wasMobile) {
      wasMobile = nowMobile;
      setExpanded(!nowMobile);
    }
  });
})();

/* ============================================================
   THEME TOGGLE — sun/moon icon, persists via devSettings
============================================================ */
(function setupThemeToggle() {
  const btn = document.getElementById('btn-theme-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const goingDark = !document.documentElement.classList.contains('theme-dark');
    devSettings.theme = goingDark ? 'dark' : 'light';
    saveDevSettings();
    applyDevSettings();
  });
})();

/* ============================================================
   SCHEMA INFERENCE — generate a JSON Schema (Draft-07) from data
============================================================ */
function inferSchema(value) {
  if (value === null) return { type: 'null' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { type: 'integer' } : { type: 'number' };
  }
  if (typeof value === 'string') {
    const fmt = detectStringFormat(value);
    const out = { type: 'string' };
    if (fmt) out.format = fmt;
    return out;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return { type: 'array', items: {} };
    const itemSchemas = value.map(inferSchema);
    const merged = mergeSchemas(itemSchemas);
    return { type: 'array', items: merged };
  }
  if (typeof value === 'object') {
    const out = { type: 'object', properties: {}, required: [] };
    const keys = Object.keys(value);
    for (const k of keys) {
      out.properties[k] = inferSchema(value[k]);
      out.required.push(k);
    }
    if (out.required.length === 0) delete out.required;
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
    const requiredCounts = {};
    schemas.forEach(s => {
      if (s.properties) Object.keys(s.properties).forEach(k => {
        if (!props[k]) props[k] = [];
        props[k].push(s.properties[k]);
      });
      if (s.required) s.required.forEach(k => { requiredCounts[k] = (requiredCounts[k] || 0) + 1; });
    });
    const merged = { type: 'object', properties: {} };
    for (const k of Object.keys(props)) merged.properties[k] = mergeSchemas(props[k]);
    const required = Object.keys(requiredCounts).filter(k => requiredCounts[k] === schemas.length);
    if (required.length > 0) merged.required = required;
    return merged;
  }
  if (types.length === 1 && types[0] === 'array') {
    const items = schemas.map(s => s.items).filter(Boolean);
    if (items.length === 0) return { type: 'array', items: {} };
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

function generateSchemaFrom(value) {
  const schema = inferSchema(value);
  schema.$schema = 'http://json-schema.org/draft-07/schema#';
  const ordered = {};
  ordered.$schema = schema.$schema;
  for (const k of Object.keys(schema)) if (k !== '$schema') ordered[k] = schema[k];
  return ordered;
}

/* ============================================================
   SCHEMA VALIDATION — JSON Schema Draft-07 (subset)
   Supports: type, properties, required, items, additionalProperties,
   minLength, maxLength, minimum, maximum, enum, pattern, format,
   minItems, maxItems, uniqueItems
============================================================ */
function validateAgainstSchema(value, schema, path) {
  path = path || '$';
  const errors = [];

  if (!schema || typeof schema !== 'object') return errors;

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = jsType(value);
    if (!types.includes(actual)) {
      errors.push({ path, message: 'Expected type ' + types.join(' or ') + ', got ' + actual });
      return errors;
    }
  }

  if (schema.enum) {
    const found = schema.enum.some(e => deepEqual(e, value));
    if (!found) errors.push({ path, message: 'Value must be one of: ' + JSON.stringify(schema.enum) });
  }

  if (schema.const !== undefined) {
    if (!deepEqual(value, schema.const)) {
      errors.push({ path, message: 'Value must equal ' + JSON.stringify(schema.const) });
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push({ path, message: 'String shorter than ' + schema.minLength });
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push({ path, message: 'String longer than ' + schema.maxLength });
    if (schema.pattern) {
      try {
        if (!new RegExp(schema.pattern).test(value)) errors.push({ path, message: 'String does not match pattern: ' + schema.pattern });
      } catch (_) {}
    }
    if (schema.format) {
      const valid = validateFormat(value, schema.format);
      if (valid === false) errors.push({ path, message: 'String does not match format: ' + schema.format });
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path, message: 'Value below minimum ' + schema.minimum });
    if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path, message: 'Value above maximum ' + schema.maximum });
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errors.push({ path, message: 'Value not above ' + schema.exclusiveMinimum });
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) errors.push({ path, message: 'Value not below ' + schema.exclusiveMaximum });
    if (schema.multipleOf !== undefined) {
      if (value % schema.multipleOf !== 0) errors.push({ path, message: 'Value not multiple of ' + schema.multipleOf });
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push({ path, message: 'Array shorter than ' + schema.minItems + ' items' });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push({ path, message: 'Array longer than ' + schema.maxItems + ' items' });
    if (schema.uniqueItems) {
      const seen = new Set();
      let hasDup = false;
      for (const item of value) {
        const k = JSON.stringify(item);
        if (seen.has(k)) { hasDup = true; break; }
        seen.add(k);
      }
      if (hasDup) errors.push({ path, message: 'Array items must be unique' });
    }
    if (schema.items) {
      if (Array.isArray(schema.items)) {
        value.forEach((item, i) => {
          if (i < schema.items.length) errors.push(...validateAgainstSchema(item, schema.items[i], path + '[' + i + ']'));
        });
      } else {
        value.forEach((item, i) => {
          errors.push(...validateAgainstSchema(item, schema.items, path + '[' + i + ']'));
        });
      }
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    if (schema.required) {
      for (const k of schema.required) {
        if (!(k in value)) errors.push({ path: path + '.' + k, message: 'Required property missing' });
      }
    }
    if (schema.properties) {
      for (const k of Object.keys(value)) {
        if (k in schema.properties) {
          errors.push(...validateAgainstSchema(value[k], schema.properties[k], path + '.' + k));
        }
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const k of Object.keys(value)) {
        if (!(k in schema.properties)) errors.push({ path: path + '.' + k, message: 'Additional property not allowed' });
      }
    }
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) {
      errors.push({ path, message: 'Object has fewer than ' + schema.minProperties + ' properties' });
    }
    if (schema.maxProperties !== undefined && Object.keys(value).length > schema.maxProperties) {
      errors.push({ path, message: 'Object has more than ' + schema.maxProperties + ' properties' });
    }
  }
  return errors;
}

function jsType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function validateFormat(s, format) {
  const checks = {
    'date-time': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/,
    'date':      /^\d{4}-\d{2}-\d{2}$/,
    'time':      /^\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/,
    'email':     /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/,
    'uri':       /^(?:https?|ftp|file|data):\/\/[^\s]+$/,
    'uuid':      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    'ipv4':      /^(?:\d{1,3}\.){3}\d{1,3}$/,
    'hostname':  /^[a-zA-Z0-9.-]+$/,
  };
  if (!checks[format]) return null;
  return checks[format].test(s);
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

/* ============================================================
   MOCK DATA GENERATION — generate fake data matching a schema
============================================================ */
const FAKE_FIRST_NAMES = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry', 'Iris', 'Jack', 'Kate', 'Liam', 'Maya', 'Noah', 'Olivia'];
const FAKE_LAST_NAMES = ['Smith', 'Johnson', 'Chen', 'Williams', 'Brown', 'Müller', 'Garcia', 'Rodriguez', 'Anderson', 'Lee', 'Kim', 'Wang', 'Patel'];
const FAKE_CITIES = ['Paris', 'Tokyo', 'Berlin', 'London', 'Sydney', 'New York', 'Toronto', 'Mumbai', 'Cairo', 'Lima'];
const FAKE_DOMAINS = ['example.com', 'acme.io', 'mailcorp.net', 'test.org'];
const FAKE_COMPANIES = ['Acme', 'Globex', 'Initech', 'Umbrella', 'Stark Industries', 'Wayne Enterprises', 'Cyberdyne'];

function rand(n) { return Math.floor(Math.random() * n); }
function pick(arr) { return arr[rand(arr.length)]; }
function randInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }
function randFloat(min, max) { return min + Math.random() * (max - min); }

function generateMockFromSchema(schema, keyHint) {
  if (!schema || typeof schema !== 'object') return null;

  if (schema.enum && schema.enum.length > 0) return pick(schema.enum);
  if (schema.const !== undefined) return schema.const;

  const types = Array.isArray(schema.type) ? schema.type : (schema.type ? [schema.type] : []);
  const type = types[0] || guessTypeFromShape(schema);

  if (type === 'null')    return null;
  if (type === 'boolean') return Math.random() < 0.5;

  if (type === 'integer') {
    const min = schema.minimum !== undefined ? schema.minimum : 1;
    const max = schema.maximum !== undefined ? schema.maximum : (min + 99);
    return randInt(Math.ceil(min), Math.floor(max));
  }
  if (type === 'number') {
    const min = schema.minimum !== undefined ? schema.minimum : 0;
    const max = schema.maximum !== undefined ? schema.maximum : (min + 100);
    return +(randFloat(min, max)).toFixed(2);
  }

  if (type === 'string') {
    if (schema.format) return mockStringByFormat(schema.format);
    if (keyHint) return mockStringByKey(keyHint);
    const minL = schema.minLength || 4;
    const maxL = schema.maxLength || 12;
    return randomWord(randInt(minL, Math.max(minL, maxL)));
  }

  if (type === 'array') {
    const minI = schema.minItems || 1;
    const maxI = schema.maxItems || 3;
    const count = randInt(minI, Math.max(minI, maxI));
    const items = schema.items || {};
    const out = [];
    for (let i = 0; i < count; i++) out.push(generateMockFromSchema(items));
    if (schema.uniqueItems) {
      const seen = new Set();
      return out.filter(x => { const k = JSON.stringify(x); if (seen.has(k)) return false; seen.add(k); return true; });
    }
    return out;
  }

  if (type === 'object') {
    const out = {};
    const props = schema.properties || {};
    const required = schema.required || Object.keys(props);
    for (const k of Object.keys(props)) {
      const isReq = required.includes(k);
      if (isReq || Math.random() < 0.7) out[k] = generateMockFromSchema(props[k], k);
    }
    return out;
  }

  return null;
}

function guessTypeFromShape(schema) {
  if (schema.properties) return 'object';
  if (schema.items) return 'array';
  if (schema.minLength !== undefined || schema.maxLength !== undefined || schema.pattern) return 'string';
  if (schema.minimum !== undefined || schema.maximum !== undefined) return 'number';
  return 'string';
}

function mockStringByFormat(fmt) {
  const now = new Date();
  switch (fmt) {
    case 'date-time': return new Date(now - rand(365 * 24 * 60 * 60 * 1000)).toISOString();
    case 'date':      return new Date(now - rand(365 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
    case 'time':      return new Date().toISOString().split('T')[1].slice(0, 8);
    case 'email':     return pick(FAKE_FIRST_NAMES).toLowerCase() + '.' + pick(FAKE_LAST_NAMES).toLowerCase() + '@' + pick(FAKE_DOMAINS);
    case 'uri':       return 'https://' + pick(FAKE_DOMAINS) + '/' + randomWord(6).toLowerCase();
    case 'uuid':      return crypto.randomUUID ? crypto.randomUUID() : ('xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx').replace(/[xy]/g, c => { const r = rand(16); return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); });
    case 'ipv4':      return randInt(1, 255) + '.' + randInt(0, 255) + '.' + randInt(0, 255) + '.' + randInt(1, 254);
    case 'hostname':  return pick(FAKE_DOMAINS);
    default:          return randomWord(8);
  }
}

function mockStringByKey(key) {
  const k = key.toLowerCase();
  if (/email/.test(k))             return mockStringByFormat('email');
  if (/url|website|link/.test(k))  return mockStringByFormat('uri');
  if (/uuid|guid/.test(k))         return mockStringByFormat('uuid');
  if (/ip(_?addr)?/.test(k))       return mockStringByFormat('ipv4');
  if (/first.?name|given.?name/.test(k)) return pick(FAKE_FIRST_NAMES);
  if (/last.?name|surname|family.?name/.test(k)) return pick(FAKE_LAST_NAMES);
  if (/full.?name|^name$|user.?name|display.?name/.test(k)) return pick(FAKE_FIRST_NAMES) + ' ' + pick(FAKE_LAST_NAMES);
  if (/city|town/.test(k))         return pick(FAKE_CITIES);
  if (/country/.test(k))           return pick(['USA', 'France', 'Japan', 'Germany', 'UK', 'India']);
  if (/company|organization|org/.test(k)) return pick(FAKE_COMPANIES);
  if (/phone|tel/.test(k))         return '+1 ' + randInt(200, 999) + '-' + randInt(100, 999) + '-' + randInt(1000, 9999);
  if (/(zip|postal)(_?code)?/.test(k)) return String(randInt(10000, 99999));
  if (/date|_at|_on$/.test(k))     return mockStringByFormat('date');
  if (/status|state/.test(k))      return pick(['active', 'pending', 'archived', 'draft']);
  if (/role/.test(k))              return pick(['admin', 'user', 'editor', 'viewer']);
  if (/title|subject/.test(k))     return capitalize(randomWord(6)) + ' ' + randomWord(8);
  return randomWord(randInt(5, 10));
}

function randomWord(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let w = '';
  for (let i = 0; i < len; i++) w += chars[rand(chars.length)];
  return w;
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* ============================================================
   SCHEMA UI WIRING
============================================================ */
const schemaInput1 = document.getElementById('schema-input-1');
const schemaInput2 = document.getElementById('schema-input-2');
const schemaInput2Card = document.getElementById('schema-input-2-card');
const schemaInput1Title = document.getElementById('schema-input-1-title');
const schemaOutput = document.getElementById('schema-output');
const schemaOutputTitle = document.getElementById('schema-output-title');
const schemaModeSelect = document.getElementById('schema-mode');

function updateSchemaMode() {
  const mode = schemaModeSelect.value;
  if (mode === 'validate') {
    schemaInput2Card.style.display = '';
    schemaInput1Title.innerHTML = 'Input <span class="tab-format">JSON</span> data';
  } else {
    schemaInput2Card.style.display = 'none';
    schemaInput1Title.innerHTML = 'Input <span class="tab-format">JSON</span> data';
  }
}
schemaModeSelect.addEventListener('change', updateSchemaMode);

document.getElementById('btn-schema-generate').addEventListener('click', () => {
  hideStatus('status-schema');
  const text = schemaInput1.value.trim();
  if (!text) {
    showStatus('status-schema', 'error', 'Paste some JSON data first.', '');
    return;
  }
  let data;
  try { data = JSON.parse(text); }
  catch (e) {
    try { const fx = Format.json.autoFix(text); data = JSON.parse(fx.fixed); }
    catch (e2) { showStatus('status-schema', 'error', 'Could not parse input.', e.message); return; }
  }
  const schema = generateSchemaFrom(data);
  schemaOutputTitle.textContent = 'Generated schema';
  renderSchemaJson(schema);
  showStatus('status-schema', 'success', '✓ Schema generated.', JSON.stringify(schema, null, 2).split('\n').length + ' lines.');
  setTimeout(() => hideStatus('status-schema'), 2000);
});

document.getElementById('btn-schema-validate').addEventListener('click', () => {
  hideStatus('status-schema');
  schemaModeSelect.value = 'validate';
  updateSchemaMode();
  const dataText = schemaInput1.value.trim();
  const schemaText = schemaInput2.value.trim();
  if (!dataText || !schemaText) {
    showStatus('status-schema', 'error', 'Both data and schema are required.', '');
    return;
  }
  let data, schema;
  try { data = JSON.parse(dataText); }
  catch (e) {
    try { data = JSON.parse(Format.json.autoFix(dataText).fixed); }
    catch (e2) { showStatus('status-schema', 'error', 'Could not parse data.', e.message); return; }
  }
  try { schema = JSON.parse(schemaText); }
  catch (e) {
    try { schema = JSON.parse(Format.json.autoFix(schemaText).fixed); }
    catch (e2) { showStatus('status-schema', 'error', 'Could not parse schema.', e.message); return; }
  }
  const errors = validateAgainstSchema(data, schema);
  schemaOutputTitle.textContent = 'Validation result';
  renderValidation(errors);
});

document.getElementById('btn-schema-mock').addEventListener('click', () => {
  hideStatus('status-schema');
  // The schema can be either in input-1 (generate mode) or input-2 (validate mode)
  let schemaText;
  if (schemaModeSelect.value === 'validate') {
    schemaText = schemaInput2.value.trim();
  } else {
    schemaText = schemaInput1.value.trim();
    // In generate mode, the input might be DATA. Try to detect:
    try {
      const parsed = JSON.parse(schemaText);
      if (parsed.$schema || (parsed.type && parsed.properties)) {
        // looks like a schema
      } else {
        // it's data, generate schema from it first
        const inferred = generateSchemaFrom(parsed);
        schemaText = JSON.stringify(inferred);
      }
    } catch (_) {}
  }
  if (!schemaText) {
    showStatus('status-schema', 'error', 'Paste a JSON Schema (or sample data) first.', '');
    return;
  }
  let schema;
  try { schema = JSON.parse(schemaText); }
  catch (e) {
    try { schema = JSON.parse(Format.json.autoFix(schemaText).fixed); }
    catch (e2) { showStatus('status-schema', 'error', 'Could not parse schema.', e.message); return; }
  }
  const count = parseInt(document.getElementById('schema-mock-count').value, 10);
  const mocks = [];
  for (let i = 0; i < count; i++) mocks.push(generateMockFromSchema(schema));
  const result = count === 1 ? mocks[0] : mocks;
  schemaOutputTitle.textContent = 'Mock data (' + count + ' record' + (count === 1 ? '' : 's') + ')';
  renderSchemaJson(result);
  showStatus('status-schema', 'success', '✓ Generated ' + count + ' mock record' + (count === 1 ? '' : 's') + '.', '');
  setTimeout(() => hideStatus('status-schema'), 2000);
});

function renderSchemaJson(obj) {
  schemaOutput.innerHTML = '';
  const text = JSON.stringify(obj, null, 2);
  const pre = document.createElement('pre');
  pre.className = 'json-view';
  pre.innerHTML = syntaxHighlightJson(text);
  schemaOutput.appendChild(pre);
  schemaOutput.dataset.text = text;
}

function renderValidation(errors) {
  schemaOutput.innerHTML = '';
  const wrap = document.createElement('div');
  if (errors.length === 0) {
    wrap.className = 'schema-result is-valid';
    wrap.innerHTML =
      '<div class="schema-result-header">' +
        '<span class="schema-result-icon">✓</span>' +
        '<span>Document is valid against the schema.</span>' +
      '</div>';
  } else {
    wrap.className = 'schema-result is-invalid';
    wrap.innerHTML =
      '<div class="schema-result-header">' +
        '<span class="schema-result-icon">✗</span>' +
        '<span>' + errors.length + ' validation error' + (errors.length === 1 ? '' : 's') + ' found</span>' +
      '</div>' +
      errors.map(e =>
        '<div class="schema-error-item"><span class="schema-error-path">' + escapeHtml(e.path) + '</span><span class="schema-error-message">' + escapeHtml(e.message) + '</span></div>'
      ).join('');
  }
  schemaOutput.appendChild(wrap);
  schemaOutput.dataset.text = errors.length === 0 ? 'Valid' : JSON.stringify(errors, null, 2);
}

document.getElementById('btn-clear-schema').addEventListener('click', () => {
  schemaInput1.value = '';
  schemaInput2.value = '';
  schemaOutput.innerHTML = '<div class="output-empty">Generated JSON Schema, validation results, or mock data will appear here.</div>';
  hideStatus('status-schema');
});

document.getElementById('btn-copy-schema-input-1').addEventListener('click', () => {
  copyToClipboard(schemaInput1.value).then(() => {
    showStatus('status-schema', 'info', 'Copied input.', '');
    setTimeout(() => hideStatus('status-schema'), 1500);
  });
});
document.getElementById('btn-copy-schema-input-2').addEventListener('click', () => {
  copyToClipboard(schemaInput2.value).then(() => {
    showStatus('status-schema', 'info', 'Copied schema.', '');
    setTimeout(() => hideStatus('status-schema'), 1500);
  });
});
document.getElementById('btn-copy-schema-output').addEventListener('click', () => {
  const text = schemaOutput.dataset.text;
  if (!text) return;
  copyToClipboard(text).then(() => {
    showStatus('status-schema', 'info', 'Copied output.', '');
    setTimeout(() => hideStatus('status-schema'), 1500);
  });
});
document.getElementById('btn-download-schema').addEventListener('click', () => {
  const text = schemaOutput.dataset.text;
  if (!text) return;
  downloadBlob(text, 'schema-output.json', 'application/json');
});

updateSchemaMode();

/* ============================================================
   DIFF — structural comparison of two JSON/YAML documents
============================================================ */
function computeDiff(a, b, path, opts) {
  path = path || '$';
  opts = opts || {};
  const out = { added: [], removed: [], changed: [], unchanged: [] };

  if (deepEqual(a, b)) {
    out.unchanged.push({ path, value: a });
    return out;
  }

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
      b.forEach((bItem, j) => {
        if (!usedB.has(j)) out.added.push({ path: path + '[' + j + ']', value: bItem });
      });
    } else {
      const max = Math.max(a.length, b.length);
      for (let i = 0; i < max; i++) {
        const subPath = path + '[' + i + ']';
        if (i >= a.length) out.added.push({ path: subPath, value: b[i] });
        else if (i >= b.length) out.removed.push({ path: subPath, value: a[i] });
        else {
          const sub = computeDiff(a[i], b[i], subPath, opts);
          mergeDiff(out, sub);
        }
      }
    }
    return out;
  }

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  for (const k of aKeys) {
    const subPath = path + '.' + k;
    if (!(k in b)) out.removed.push({ path: subPath, value: a[k] });
    else {
      const sub = computeDiff(a[k], b[k], subPath, opts);
      mergeDiff(out, sub);
    }
  }
  for (const k of bKeys) {
    if (!(k in a)) out.added.push({ path: path + '.' + k, value: b[k] });
  }
  return out;
}

function mergeDiff(target, sub) {
  target.added.push(...sub.added);
  target.removed.push(...sub.removed);
  target.changed.push(...sub.changed);
  target.unchanged.push(...sub.unchanged);
}

const diffInputA = document.getElementById('diff-input-a');
const diffInputB = document.getElementById('diff-input-b');
const diffOutput = document.getElementById('diff-output');

document.getElementById('btn-diff-compare').addEventListener('click', runDiff);

function runDiff() {
  hideStatus('status-diff');
  const aText = diffInputA.value.trim();
  const bText = diffInputB.value.trim();
  if (!aText || !bText) {
    showStatus('status-diff', 'error', 'Both inputs required.', 'Paste content in both Original and Modified.');
    return;
  }
  const parse = txt => {
    const F = fmt();
    try { return F.parseStrict(txt); }
    catch (e) {
      const fx = F.autoFix(txt);
      return F.parseStrict(fx.fixed);
    }
  };
  let a, b;
  try { a = parse(aText); }
  catch (e) { showStatus('status-diff', 'error', 'Could not parse Original.', e.message); return; }
  try { b = parse(bText); }
  catch (e) { showStatus('status-diff', 'error', 'Could not parse Modified.', e.message); return; }

  const ignoreOrder = document.getElementById('diff-ignore-order').checked;
  const result = computeDiff(a, b, '$', { ignoreOrder });

  document.getElementById('diff-count-added').textContent = result.added.length;
  document.getElementById('diff-count-removed').textContent = result.removed.length;
  document.getElementById('diff-count-changed').textContent = result.changed.length;
  document.getElementById('diff-count-unchanged').textContent = result.unchanged.length;
  document.getElementById('diff-stats').style.display = 'flex';

  renderDiff(result, a, b);
}

function renderDiff(result, a, b) {
  const mode = document.getElementById('diff-view-mode').value;
  diffOutput.innerHTML = '';

  if (mode === 'paths') {
    const list = document.createElement('div');
    list.className = 'diff-path-list';
    if (result.added.length === 0 && result.removed.length === 0 && result.changed.length === 0) {
      list.innerHTML = '<div class="output-empty">No differences found.</div>';
    } else {
      result.changed.forEach(c => list.appendChild(renderPathItem('changed', c.path, c.oldValue, c.newValue)));
      result.added.forEach(a => list.appendChild(renderPathItem('added', a.path, null, a.value)));
      result.removed.forEach(r => list.appendChild(renderPathItem('removed', r.path, r.value, null)));
    }
    diffOutput.appendChild(list);
    return;
  }

  if (mode === 'side') {
    const wrap = document.createElement('div');
    wrap.className = 'diff-side-by-side';
    const leftSide = document.createElement('div');
    const rightSide = document.createElement('div');
    leftSide.className = 'diff-side diff-side-left';
    rightSide.className = 'diff-side diff-side-right';
    leftSide.innerHTML = '<div class="diff-side-header">Original</div>';
    rightSide.innerHTML = '<div class="diff-side-header">Modified</div>';
    const lines = buildSideBySideLines(a, b, result);
    lines.forEach(line => {
      leftSide.appendChild(buildDiffLine(line.left));
      rightSide.appendChild(buildDiffLine(line.right));
    });
    wrap.appendChild(leftSide);
    wrap.appendChild(rightSide);
    diffOutput.appendChild(wrap);
    return;
  }

  // unified
  const wrap = document.createElement('div');
  wrap.className = 'diff-unified';
  const lines = buildUnifiedLines(a, b, result);
  lines.forEach(line => wrap.appendChild(buildDiffLine(line)));
  diffOutput.appendChild(wrap);
}

function renderPathItem(kind, path, oldV, newV) {
  const div = document.createElement('div');
  div.className = 'diff-path-item ' + kind;
  let valuesHtml = '';
  if (kind === 'changed') {
    valuesHtml =
      '<div class="diff-path-values">' +
        '<span class="diff-old">' + escapeHtml(JSON.stringify(oldV)) + '</span>' +
        '<span class="diff-arrow">→</span>' +
        '<span class="diff-new">' + escapeHtml(JSON.stringify(newV)) + '</span>' +
      '</div>';
  } else {
    const v = kind === 'added' ? newV : oldV;
    valuesHtml = '<div class="diff-path-values">' + escapeHtml(JSON.stringify(v)) + '</div>';
  }
  div.innerHTML =
    '<div>' +
      '<div><span class="diff-path-label">' + kind + '</span> <span class="diff-path-text">' + escapeHtml(path) + '</span></div>' +
      valuesHtml +
    '</div>';
  return div;
}

function buildDiffLine(spec) {
  const el = document.createElement('span');
  el.className = 'diff-line';
  if (spec.kind) el.classList.add(spec.kind);
  el.textContent = spec.text || ' ';
  return el;
}

function buildSideBySideLines(a, b, result) {
  const changedPaths = new Set(result.changed.map(c => c.path));
  const addedPaths = new Set(result.added.map(c => c.path));
  const removedPaths = new Set(result.removed.map(c => c.path));

  const aLines = jsonToLines(a, '$', changedPaths, addedPaths, removedPaths, 'old');
  const bLines = jsonToLines(b, '$', changedPaths, addedPaths, removedPaths, 'new');
  const max = Math.max(aLines.length, bLines.length);
  const out = [];
  for (let i = 0; i < max; i++) {
    out.push({
      left:  aLines[i] || { kind: 'placeholder', text: '' },
      right: bLines[i] || { kind: 'placeholder', text: '' },
    });
  }
  return out;
}

function buildUnifiedLines(a, b, result) {
  const aLines = jsonToLines(a, '$', new Set(result.changed.map(c => c.path)), new Set(result.added.map(c => c.path)), new Set(result.removed.map(c => c.path)), 'old');
  const bLines = jsonToLines(b, '$', new Set(result.changed.map(c => c.path)), new Set(result.added.map(c => c.path)), new Set(result.removed.map(c => c.path)), 'new');
  const out = [];
  // Simple unified: show removed lines from A, then added lines from B
  aLines.forEach(line => {
    if (line.kind === 'removed' || line.kind === 'changed') out.push({ kind: 'removed', text: '- ' + line.text });
    else out.push({ kind: 'context', text: '  ' + line.text });
  });
  bLines.forEach(line => {
    if (line.kind === 'added' || line.kind === 'changed') out.push({ kind: 'added', text: '+ ' + line.text });
  });
  return out;
}

function jsonToLines(value, path, changedPaths, addedPaths, removedPaths, side) {
  // Render value as indented JSON, tagging each line by its path
  const lines = [];
  const indentStr = '  ';

  function classify(p) {
    if (side === 'old' && removedPaths.has(p)) return 'removed';
    if (side === 'new' && addedPaths.has(p)) return 'added';
    if (changedPaths.has(p)) return 'changed';
    // Also: any ancestor change
    return null;
  }

  function write(text, kind) {
    lines.push({ kind, text });
  }

  function emit(v, p, prefix, depth, suffix) {
    const pad = indentStr.repeat(depth);
    const kind = classify(p);
    if (v === null || typeof v !== 'object') {
      write(pad + prefix + JSON.stringify(v) + (suffix || ''), kind);
      return;
    }
    if (Array.isArray(v)) {
      if (v.length === 0) { write(pad + prefix + '[]' + (suffix || ''), kind); return; }
      write(pad + prefix + '[', kind);
      v.forEach((item, i) => {
        const childP = p + '[' + i + ']';
        emit(item, childP, '', depth + 1, i < v.length - 1 ? ',' : '');
      });
      write(pad + ']' + (suffix || ''), kind);
      return;
    }
    const keys = Object.keys(v);
    if (keys.length === 0) { write(pad + prefix + '{}' + (suffix || ''), kind); return; }
    write(pad + prefix + '{', kind);
    keys.forEach((k, i) => {
      const childP = p + '.' + k;
      emit(v[k], childP, '"' + k + '": ', depth + 1, i < keys.length - 1 ? ',' : '');
    });
    write(pad + '}' + (suffix || ''), kind);
  }

  emit(value, path, '', 0, '');
  return lines;
}

document.getElementById('btn-clear-diff').addEventListener('click', () => {
  diffInputA.value = '';
  diffInputB.value = '';
  diffOutput.innerHTML = '<div class="output-empty">Paste two documents above and click Compare to see the differences.</div>';
  document.getElementById('diff-stats').style.display = 'none';
  hideStatus('status-diff');
});

document.getElementById('diff-view-mode').addEventListener('change', () => {
  // Re-render if we have a current diff
  if (document.getElementById('diff-stats').style.display !== 'none') {
    document.getElementById('btn-diff-compare').click();
  }
});

document.getElementById('diff-ignore-order').addEventListener('change', () => {
  if (document.getElementById('diff-stats').style.display !== 'none') {
    document.getElementById('btn-diff-compare').click();
  }
});

/* ============================================================
   INFO MODALS — About / Contact / Terms / Privacy
============================================================ */
(function setupInfoModals() {
  const backdrop = document.getElementById('info-modal-backdrop');
  if (!backdrop) return;
  const contents = backdrop.querySelectorAll('[data-info-content]');
  const closeBtn = backdrop.querySelector('.info-modal-close');

  function openInfoModal(which) {
    contents.forEach(c => c.classList.toggle('active', c.dataset.infoContent === which));
    backdrop.hidden = false;
    document.body.style.overflow = 'hidden';
    const modal = backdrop.querySelector('.info-modal');
    if (modal) modal.scrollTop = 0;
  }
  function closeInfoModal() {
    backdrop.hidden = true;
    document.body.style.overflow = '';
  }

  document.addEventListener('click', e => {
    const trigger = e.target.closest('[data-info-modal]');
    if (trigger) {
      e.preventDefault();
      openInfoModal(trigger.dataset.infoModal);
      return;
    }
    if (e.target === backdrop || e.target === closeBtn) {
      closeInfoModal();
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !backdrop.hidden) closeInfoModal();
  });

  window.openInfoModal = openInfoModal;
  window.closeInfoModal = closeInfoModal;
})();

/* ============================================================
   CONTACT FORM — submits to /api/contact (Netlify Function → Supabase)
============================================================ */
(function setupContactForm() {
  const form = document.getElementById('contact-form');
  if (!form) return;

  const messageEl = document.getElementById('contact-message');
  const charCountEl = document.getElementById('contact-char-count');
  const charCountWrap = document.querySelector('.contact-char-count');
  const statusEl = document.getElementById('contact-form-status');
  const cancelBtn = document.getElementById('btn-contact-cancel');
  const submitBtn = document.getElementById('btn-contact-submit');

  function updateCharCount() {
    const n = messageEl.value.length;
    charCountEl.textContent = n;
    charCountWrap.classList.toggle('near-limit', n > 4500);
    charCountWrap.classList.toggle('over-limit', n > 5000);
  }
  messageEl.addEventListener('input', updateCharCount);

  cancelBtn.addEventListener('click', () => {
    if (window.closeInfoModal) window.closeInfoModal();
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    statusEl.textContent = '';
    statusEl.className = '';

    const name = document.getElementById('contact-name').value.trim();
    const email = document.getElementById('contact-email').value.trim();
    const subject = document.getElementById('contact-subject').value.trim();
    const message = messageEl.value.trim();
    const honeypot = document.getElementById('contact-website').value;

    if (!subject || !message) {
      statusEl.textContent = '✗ Subject and message are required.';
      statusEl.className = 'error';
      return;
    }
    if (message.length > 5000) {
      statusEl.textContent = '✗ Message exceeds 5000-character limit.';
      statusEl.className = 'error';
      return;
    }
    if (email && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
      statusEl.textContent = '✗ Email address looks invalid.';
      statusEl.className = 'error';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, subject, message, website: honeypot }),
      });
      const data = await response.json();
      if (response.ok && data.ok) {
        statusEl.textContent = '✓ Thank you — your message has been sent. We\'ll get back to you soon.';
        statusEl.className = 'success';
        form.reset();
        updateCharCount();
        setTimeout(() => {
          if (window.closeInfoModal) window.closeInfoModal();
        }, 2200);
      } else {
        statusEl.textContent = '✗ ' + (data.message || 'Could not send message. Please try again.');
        statusEl.className = 'error';
      }
    } catch (err) {
      statusEl.textContent = '✗ Network error: ' + err.message;
      statusEl.className = 'error';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send message';
    }
  });
})();

/* ============================================================
   CONTACT HISTORY — developer-only view of all submissions
============================================================ */
const ADMIN_TOKEN_KEY = 'jsonpi.adminToken';

function showContactHistoryTab(show) {
  const tab = document.querySelector('.tab[data-tab="contact-history"]');
  if (!tab) return;
  if (show) {
    tab.removeAttribute('hidden');
  } else {
    tab.setAttribute('hidden', '');
    // If the user was viewing the panel when we hid the tab, fall back to a default panel
    if (tab.classList.contains('active')) {
      const fallback = document.querySelector('.tab[data-tab="json-in"]');
      if (fallback) fallback.click();
    }
  }
}

(function setupContactHistory() {
  const gate = document.getElementById('contact-admin-gate');
  const container = document.getElementById('contact-history-container');
  const tokenInput = document.getElementById('contact-admin-token-input');
  const errEl = document.getElementById('contact-admin-error');
  const submitBtn = document.getElementById('btn-contact-admin-submit');
  const listEl = document.getElementById('contact-history-list');
  const countEl = document.getElementById('contact-history-count');
  const searchEl = document.getElementById('contact-history-search');
  const sortEl = document.getElementById('contact-history-sort');
  const refreshBtn = document.getElementById('btn-contact-refresh');
  const logoutBtn = document.getElementById('btn-contact-logout-admin');

  let allContacts = [];

  function showGate(show) {
    gate.hidden = !show;
    container.hidden = show;
  }

  async function fetchContacts(token) {
    errEl.textContent = '';
    listEl.innerHTML = '<div class="output-empty">Loading...</div>';
    try {
      const response = await fetch('/api/contact-history', {
        headers: { 'X-Admin-Token': token },
      });
      if (response.status === 401 || response.status === 403) {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        showGate(true);
        errEl.textContent = '✗ Invalid admin token.';
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        errEl.textContent = '✗ Server error: ' + (body.message || response.status);
        listEl.innerHTML = '<div class="output-empty">Could not load contacts.</div>';
        return;
      }
      const data = await response.json();
      allContacts = data.contacts || [];
      localStorage.setItem(ADMIN_TOKEN_KEY, token);
      showGate(false);
      renderList();
    } catch (err) {
      errEl.textContent = '✗ Network error: ' + err.message;
    }
  }

  function renderList() {
    const q = (searchEl.value || '').toLowerCase().trim();
    const sortMode = sortEl.value;
    let list = allContacts.slice();
    if (q) {
      list = list.filter(c => {
        const blob = [c.name || '', c.email || '', c.subject || '', c.message || ''].join(' ').toLowerCase();
        return blob.includes(q);
      });
    }
    list.sort((a, b) => {
      const da = new Date(a.created_at).getTime();
      const db = new Date(b.created_at).getTime();
      return sortMode === 'oldest' ? da - db : db - da;
    });
    countEl.textContent = list.length + ' of ' + allContacts.length;
    if (list.length === 0) {
      listEl.innerHTML = '<div class="output-empty">' + (allContacts.length === 0 ? 'No contact submissions yet.' : 'No matches.') + '</div>';
      return;
    }
    listEl.innerHTML = list.map(renderContactCard).join('');
  }

  function renderContactCard(c) {
    const when = new Date(c.created_at).toLocaleString();
    const fromBits = [];
    if (c.name) fromBits.push('<span class="contact-from-name">' + escapeHtml(c.name) + '</span>');
    if (c.email) fromBits.push('<span class="contact-from-email">&lt;<a href="mailto:' + escapeHtml(c.email) + '">' + escapeHtml(c.email) + '</a>&gt;</span>');
    const from = fromBits.length ? fromBits.join(' ') : '<span class="contact-card-anon">anonymous</span>';

    let replyIndicator = '';
    if (c.reply_count > 0) {
      const lastReply = c.last_reply_at ? new Date(c.last_reply_at).toLocaleString() : '';
      replyIndicator = '<span class="contact-replied-badge" title="Last reply: ' + escapeHtml(lastReply) + '">✓ Replied' + (c.reply_count > 1 ? ' ' + c.reply_count + '×' : '') + '</span>';
    }

    const replyBtnAttrs = c.email
      ? 'data-reply-id="' + escapeHtml(String(c.id)) + '"'
      : 'disabled title="No email — cannot reply"';
    const replyBtn = '<button class="btn-reply" ' + replyBtnAttrs + '>↩ Reply</button>';

    return '<article class="contact-card" data-contact-id="' + escapeHtml(String(c.id)) + '">' +
      '<div class="contact-card-head">' +
        '<div class="contact-card-subject">' + escapeHtml(c.subject || '(no subject)') + '</div>' +
        '<div class="contact-card-meta">' +
          replyIndicator +
          '<div class="contact-card-time">' + escapeHtml(when) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="contact-card-from">From: ' + from + '</div>' +
      '<div class="contact-card-message">' + escapeHtml(c.message || '') + '</div>' +
      '<div class="contact-card-actions">' + replyBtn + '</div>' +
    '</article>';
  }

  // Reply button delegation
  listEl.addEventListener('click', e => {
    const btn = e.target.closest('.btn-reply');
    if (!btn || btn.disabled) return;
    const contactId = btn.getAttribute('data-reply-id');
    const contact = allContacts.find(c => String(c.id) === contactId);
    if (contact && window.openReplyModal) window.openReplyModal(contact);
  });

  searchEl.addEventListener('input', renderList);
  sortEl.addEventListener('change', renderList);
  refreshBtn.addEventListener('click', () => {
    const t = localStorage.getItem(ADMIN_TOKEN_KEY);
    if (t) fetchContacts(t);
  });
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    allContacts = [];
    listEl.innerHTML = '<div class="output-empty">Logged out.</div>';
    showGate(true);
  });
  submitBtn.addEventListener('click', () => {
    const t = tokenInput.value.trim();
    if (!t) { errEl.textContent = 'Enter a token.'; return; }
    fetchContacts(t);
  });
  tokenInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submitBtn.click(); }
  });

  // When the Contact History tab is clicked, auto-attempt with stored token
  const tabBtn = document.querySelector('.tab[data-tab="contact-history"]');
  if (tabBtn) {
    tabBtn.addEventListener('click', () => {
      const t = localStorage.getItem(ADMIN_TOKEN_KEY);
      if (t) fetchContacts(t);
      else showGate(true);
    });
  }
})();

/* ============================================================
   REPLY MODAL — send email reply via /api/contact-reply
============================================================ */
(function setupReplyModal() {
  const backdrop = document.getElementById('reply-modal-backdrop');
  if (!backdrop) return;
  const closeBtn = document.getElementById('btn-reply-modal-close');
  const cancelBtn = document.getElementById('btn-reply-cancel');
  const sendBtn = document.getElementById('btn-reply-send');
  const bodyEl = document.getElementById('reply-body');
  const charCount = document.getElementById('reply-char-count');
  const statusEl = document.getElementById('reply-modal-status');
  const metaEl = document.getElementById('reply-modal-meta');
  const origSubjectEl = document.getElementById('reply-original-subject');
  const origBodyEl = document.getElementById('reply-original-body');

  let currentContactId = null;

  function open(contact) {
    currentContactId = contact.id;
    metaEl.textContent = 'To: ' + (contact.name ? contact.name + ' <' + contact.email + '>' : contact.email);
    origSubjectEl.textContent = contact.subject || '(no subject)';
    origBodyEl.textContent = contact.message || '';
    bodyEl.value = '';
    statusEl.textContent = '';
    statusEl.className = '';
    charCount.textContent = '0';
    backdrop.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => bodyEl.focus(), 50);
  }
  function close() {
    backdrop.hidden = true;
    document.body.style.overflow = '';
    currentContactId = null;
  }

  bodyEl.addEventListener('input', () => {
    charCount.textContent = bodyEl.value.length;
  });

  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !backdrop.hidden) close();
  });

  sendBtn.addEventListener('click', async () => {
    const reply = bodyEl.value.trim();
    if (!reply) {
      statusEl.textContent = '✗ Reply body is empty.';
      statusEl.className = 'error';
      return;
    }
    if (reply.length > 10000) {
      statusEl.textContent = '✗ Reply exceeds 10000 characters.';
      statusEl.className = 'error';
      return;
    }
    const token = localStorage.getItem('jsonpi.adminToken');
    if (!token) {
      statusEl.textContent = '✗ Admin token missing. Re-authenticate in the Contact History tab.';
      statusEl.className = 'error';
      return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';
    statusEl.textContent = '';
    statusEl.className = '';

    try {
      const response = await fetch('/api/contact-reply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': token,
        },
        body: JSON.stringify({ contact_id: currentContactId, reply_body: reply }),
      });
      const data = await response.json();
      if (response.ok && data.ok) {
        statusEl.textContent = '✓ Reply sent to ' + data.sent_to;
        statusEl.className = 'success';
        // Trigger contact history refresh after a moment so the "Replied" badge updates
        setTimeout(() => {
          close();
          const refreshBtn = document.getElementById('btn-contact-refresh');
          if (refreshBtn) refreshBtn.click();
        }, 1400);
      } else {
        statusEl.textContent = '✗ ' + (data.message || 'Could not send reply.');
        statusEl.className = 'error';
      }
    } catch (err) {
      statusEl.textContent = '✗ Network error: ' + err.message;
      statusEl.className = 'error';
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send reply';
    }
  });

  // Expose for the contact history list to call
  window.openReplyModal = open;
})();

applyDevSettings();

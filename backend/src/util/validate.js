'use strict';

// Minimal validation helpers — enough to keep handlers clean without a library.
const isStr = (v, max = 10000) => typeof v === 'string' && v.length > 0 && v.length <= max;
const isOptStr = (v, max = 10000) => v == null || (typeof v === 'string' && v.length <= max);

function badRequest(res, detail, fields) {
  return res.status(400).json({ error: 'validation_failed', detail, fields });
}

// CSV builder (RFC-4180-ish; quotes fields containing comma/quote/newline).
function toCSV(headers, rows) {
  const esc = (v) => {
    v = v == null ? '' : String(v);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
}

module.exports = { isStr, isOptStr, badRequest, toCSV };

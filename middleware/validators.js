// middleware/validators.js
// Shared validation/sanitization helpers used across routes.
// Using validator.js for battle-tested checks + manual escaping for XSS safety.

const validator = require('validator');

// Accepts international-style numbers: optional leading +, 7-15 digits total.
// Strips spaces/dashes/parentheses before validating.
function isValidPhoneNumber(raw) {
  if (typeof raw !== 'string') return false;
  const cleaned = raw.replace(/[\s\-()]/g, '');
  return validator.isMobilePhone(cleaned, 'any', { strictMode: false }) &&
         /^\+?\d{7,15}$/.test(cleaned);
}

function normalizePhoneNumber(raw) {
  return raw.replace(/[\s\-()]/g, '');
}

// Escape any string that will ever be rendered as HTML, defense in depth
// even though the frontend also uses textContent (not innerHTML) for
// user-supplied data.
function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  return validator.escape(validator.trim(str));
}

function isNonEmptyString(val, maxLen = 500) {
  return typeof val === 'string' && val.trim().length > 0 && val.trim().length <= maxLen;
}

function isPositiveInteger(val) {
  const n = Number(val);
  return Number.isInteger(n) && n > 0;
}

module.exports = {
  isValidPhoneNumber,
  normalizePhoneNumber,
  sanitizeText,
  isNonEmptyString,
  isPositiveInteger
};

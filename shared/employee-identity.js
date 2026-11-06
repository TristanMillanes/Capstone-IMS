/* Employee IDs are text. Keep leading zeroes; the login suffix is automatic. */
(function (root) {
  'use strict';
  const suffix = '@pgenro.ims';
  function normalize(value) {
    if (typeof value !== 'string') throw new Error('Enter your employee ID.');
    const number = value.trim().replace(/@pgenro\.ims$/i, '');
    if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/.test(number) || number.endsWith('.') || number.includes('..')) {
      throw new Error('Use 1–64 letters, numbers, dots, underscores or hyphens for your employee ID.');
    }
    return number;
  }
  const identity = Object.freeze({ suffix, normalize, email: value => normalize(value).toLowerCase() + suffix });
  root.PGENRO_EMPLOYEE_ID = identity;
  if (typeof module === 'object' && module.exports) module.exports = identity;
})(typeof window === 'object' ? window : globalThis);

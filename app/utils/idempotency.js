const { createHash } = require('crypto');

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function buildRequestFingerprint(payload) {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

module.exports = {
  buildRequestFingerprint,
  stableStringify
};

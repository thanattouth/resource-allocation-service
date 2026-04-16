const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuidResourceId(value) {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value.trim());
}

module.exports = {
  isUuidResourceId
};

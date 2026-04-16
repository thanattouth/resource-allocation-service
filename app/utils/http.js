function sendError(res, statusCode, traceId, errorCode, message, details, metadata = {}) {
  const payload = {
    error_code: errorCode,
    message,
    trace_id: traceId
  };

  if (details) {
    payload.details = details;
  }

  Object.assign(payload, metadata);

  return res.status(statusCode).json(payload);
}

function sendTimeoutError(res, statusCode, traceId, errorCode, message, details) {
  return sendError(res, statusCode, traceId, errorCode, message, details, {
    retryable: true
  });
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no'].includes(normalized)) {
      return false;
    }
  }

  return defaultValue;
}

function parseCoordinate(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

module.exports = {
  parseBoolean,
  parseCoordinate,
  sendError,
  sendTimeoutError
};

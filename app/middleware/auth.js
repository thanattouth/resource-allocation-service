const { sendError } = require('../utils/http');

function getExpectedToken(envKey, fallbackValue) {
  return process.env[envKey] || fallbackValue;
}

function matchesBearerToken(headerValue, expectedToken) {
  if (!headerValue || !expectedToken) {
    return false;
  }

  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return Boolean(match && match[1] === expectedToken);
}

function matchesApiKey(headerValue, expectedToken) {
  if (!headerValue || !expectedToken) {
    return false;
  }

  const normalized = headerValue.trim();
  return normalized === expectedToken || normalized === `ApiKey ${expectedToken}`;
}

function requireDispatcherAuth(req, res, next) {
  const authorization = req.get('Authorization');
  const expectedToken = getExpectedToken('DISPATCHER_BEARER_TOKEN', 'dispatcher-dev-token');

  if (!authorization) {
    return sendError(
      res,
      401,
      req.traceId,
      'AUTHORIZATION_REQUIRED',
      'Authorization header is required.'
    );
  }

  if (!matchesBearerToken(authorization, expectedToken)) {
    return sendError(
      res,
      401,
      req.traceId,
      'INVALID_AUTHORIZATION',
      'Authorization token is invalid for dispatcher access.'
    );
  }

  req.auth = { actor: 'dispatcher', scheme: 'Bearer' };
  return next();
}

function requireAllocationAuth(req, res, next) {
  const authorization = req.get('Authorization');
  const expectedBearer = getExpectedToken('DISPATCHER_BEARER_TOKEN', 'dispatcher-dev-token');
  const expectedApiKey = getExpectedToken('ALLOCATION_API_KEY', '');

  if (!authorization) {
    return sendError(
      res,
      401,
      req.traceId,
      'AUTHORIZATION_REQUIRED',
      'Authorization header is required.'
    );
  }

  if (matchesBearerToken(authorization, expectedBearer)) {
    req.auth = { actor: 'dispatcher', scheme: 'Bearer' };
    return next();
  }

  if (matchesApiKey(authorization, expectedApiKey)) {
    req.auth = { actor: 'upstream-service', scheme: 'ApiKey' };
    return next();
  }

  return sendError(
    res,
    401,
    req.traceId,
    'INVALID_AUTHORIZATION',
    'Authorization token is invalid for allocation access.'
  );
}

function requireTelemetryAuth(req, res, next) {
  const authorization = req.get('Authorization');
  const expectedBearer = getExpectedToken('TELEMETRY_BEARER_TOKEN', 'telemetry-device-token');
  const expectedApiKey = getExpectedToken('TELEMETRY_API_KEY', 'telemetry-device-key');

  if (!authorization) {
    return sendError(
      res,
      401,
      req.traceId,
      'AUTHORIZATION_REQUIRED',
      'Authorization header is required.'
    );
  }

  if (matchesBearerToken(authorization, expectedBearer)) {
    req.auth = { actor: 'resource-device', scheme: 'Bearer' };
    return next();
  }

  if (matchesApiKey(authorization, expectedApiKey)) {
    req.auth = { actor: 'resource-device', scheme: 'ApiKey' };
    return next();
  }

  return sendError(
    res,
    401,
    req.traceId,
    'INVALID_AUTHORIZATION',
    'Authorization token is invalid for telemetry access.'
  );
}

module.exports = {
  requireAllocationAuth,
  requireDispatcherAuth,
  requireTelemetryAuth
};

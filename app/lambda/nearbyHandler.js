const { randomUUID } = require('node:crypto');

const {
  searchNearbyResources
} = require('../services/nearbyService');
const {
  validateDispatcherAuthorizationHeader
} = require('../middleware/auth');

function buildLambdaResponse(statusCode, traceId, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'x-correlation-id': traceId
    },
    body: JSON.stringify(body)
  };
}

function getHeader(headers = {}, headerName) {
  const targetName = headerName.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === targetName);
  return entry ? entry[1] : undefined;
}

function createNearbyLambdaHandler({
  searchNearbyResourcesImpl = searchNearbyResources,
  validateDispatcherAuthorizationHeaderImpl = validateDispatcherAuthorizationHeader
} = {}) {
  return async function nearbyHandler(event = {}) {
    const traceId =
      getHeader(event.headers, 'x-correlation-id') ||
      getHeader(event.headers, 'x-request-id') ||
      randomUUID();

    const authorization = getHeader(event.headers, 'authorization');
    const authResult = validateDispatcherAuthorizationHeaderImpl(authorization);

    if (!authResult.ok) {
      return buildLambdaResponse(traceId ? 401 : 401, traceId, {
        error_code: authResult.errorCode,
        message: authResult.message,
        trace_id: traceId
      });
    }

    try {
      const payload = await searchNearbyResourcesImpl(
        {
          ...event.queryStringParameters,
          traceId
        }
      );

      return buildLambdaResponse(200, traceId, payload);
    } catch (error) {
      console.error('[nearbyLambda] Handler error', {
        traceId,
        statusCode: error.statusCode,
        errorCode: error.errorCode,
        message: error.message
      });
      const statusCode = error.statusCode || 500;
      const body = {
        error_code: error.errorCode || 'UNEXPECTED_SERVER_ERROR',
        message: error.message || 'Unexpected server error',
        trace_id: traceId
      };

      if (error.details) {
        body.details = error.details;
      }

      if (error.metadata && typeof error.metadata === 'object') {
        Object.assign(body, error.metadata);
      }

      return buildLambdaResponse(statusCode, traceId, body);
    }
  };
}

const nearbyHandler = createNearbyLambdaHandler();

module.exports = {
  buildLambdaResponse,
  createNearbyLambdaHandler,
  nearbyHandler
};

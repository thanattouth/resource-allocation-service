const { randomUUID } = require('crypto');

function requestContext(req, res, next) {
  const incomingTraceId = req.get('x-correlation-id') || req.get('x-request-id');
  req.traceId = incomingTraceId || randomUUID();
  res.setHeader('x-correlation-id', req.traceId);
  next();
}

module.exports = requestContext;

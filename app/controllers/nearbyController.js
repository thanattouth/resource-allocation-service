const { sendError } = require('../utils/http');
const { searchNearbyResources } = require('../services/nearbyService');

async function getNearbyResources(req, res) {
    try {
        const payload = await searchNearbyResources({
            ...req.query,
            traceId: req.traceId
        });
        return res.json(payload);
    } catch (error) {
        console.error('[nearby] Error:', error.message);
        return sendError(
            res,
            error.statusCode || 500,
            req.traceId,
            error.errorCode || 'UNEXPECTED_SERVER_ERROR',
            error.message || 'Unexpected server error',
            error.details,
            error.metadata
        );
    }
}

module.exports = getNearbyResources;

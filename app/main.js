require('dotenv').config();
const express = require('express');
const app = express();

const getNearbyResources = require('./controllers/nearbyController');
const allocateResource   = require('./controllers/allocateController');
const startTransport     = require('./controllers/transportStartController');
const updateTelemetry    = require('./controllers/telemetryController');
const requestContext = require('./middleware/requestContext');
const {
    requireAllocationAuth,
    requireDispatcherAuth,
    requireTelemetryAuth
} = require('./middleware/auth');
const { sendError } = require('./utils/http');

app.use(express.json());
app.use(requestContext);

// Health check — สำหรับ EC2 / load balancer ตรวจสอบว่า app ยังทำงานอยู่
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), trace_id: req.traceId });
});

// Routes
app.get('/v1/resources/nearby', requireDispatcherAuth, getNearbyResources);
app.post('/v1/incidents/:incident_id/allocations', requireAllocationAuth, allocateResource);
app.post('/v1/resources/:resource_id/transport-start', requireDispatcherAuth, startTransport);
app.patch('/v1/resources/:resource_id/telemetry', requireTelemetryAuth, updateTelemetry);

// Global error handler
app.use((err, req, res, next) => {
    console.error('[ERROR]', err.stack);
    return sendError(
        res,
        500,
        req.traceId,
        'UNEXPECTED_SERVER_ERROR',
        'Unexpected server error'
    );
});

function startServer() {
    const PORT = process.env.PORT || 3000;
    const server = app.listen(PORT, () => {
        console.log(`[main] Resource Service running on port ${PORT}`);
        console.log(`[main] ENV: ${process.env.NODE_ENV || 'development'}`);
    });

    // Graceful shutdown — สำหรับ Docker stop / EC2 terminate
    process.on('SIGTERM', () => {
        console.log('[main] SIGTERM received — shutting down gracefully');
        server.close(() => {
            console.log('[main] HTTP server closed');
            process.exit(0);
        });
    });

    return server;
}

if (require.main === module) {
    startServer();
}

module.exports = { app, startServer };

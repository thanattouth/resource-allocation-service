require('dotenv').config();
const express = require('express');
const app = express();

const getNearbyResources = require('./controllers/nearbyController');
const allocateResource   = require('./controllers/allocateController');
const updateTelemetry    = require('./controllers/telemetryController');

app.use(express.json());

// Health check — สำหรับ EC2 / load balancer ตรวจสอบว่า app ยังทำงานอยู่
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.get('/v1/resources/nearby',                   getNearbyResources);
app.post('/v1/incidents/:incident_id/allocations', allocateResource);
app.patch('/v1/resources/:resource_id/telemetry',  updateTelemetry);

// Global error handler
app.use((err, req, res, next) => {
    console.error('[ERROR]', err.stack);
    res.status(500).json({ error: 'Unexpected server error' });
});

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

module.exports = app;

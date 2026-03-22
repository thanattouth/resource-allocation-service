const express = require('express');
const app = express();

const getNearbyResources = require('./nearbyController');
const allocateResource = require('./allocateController');
const updateTelemetry = require('./telemetryController');

app.use(express.json());

// Routes
app.get('/v1/resources/nearby', getNearbyResources);
app.post('/v1/incidents/:incident_id/allocations', allocateResource);
app.patch('/v1/resources/:resource_id/telemetry', updateTelemetry);

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: "Unexpected server error" });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Resource Service is running on port ${PORT}`);
});
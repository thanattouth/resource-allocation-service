const pool = require('./db');

async function getNearbyResources(req, res) {
  const { lat, long, radius = 5000 } = req.query;
  if (!lat || !long) return res.status(400).json({ error: "ระบุพิกัด lat/long" });

  try {
    const query = `
            SELECT resource_id, resource_type, status, battery_level, capabilities, version,
                json_build_object('lat', ST_Y(current_location::geometry), 'long', ST_X(current_location::geometry)) AS current_location,
                ST_Distance(current_location::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) / 1000 AS distance_km
            FROM resources
            WHERE ST_DWithin(current_location::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
            ORDER BY distance_km ASC;
        `;
    const result = await pool.query(query, [parseFloat(lat), parseFloat(long), parseFloat(radius)]);
    res.json({ count: result.rowCount, resources: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = getNearbyResources;
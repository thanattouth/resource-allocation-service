const { Client } = require('pg');

const client = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

async function setupDatabase() {
    try {
        await client.connect();
        console.log('[init-db] Connected to RDS successfully!');

        await client.query('CREATE EXTENSION IF NOT EXISTS postgis;');
        await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS resources (
                resource_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                resource_type       VARCHAR(50) NOT NULL,
                capacity            INT DEFAULT 0,
                status              VARCHAR(20) DEFAULT 'AVAILABLE',
                current_location    GEOGRAPHY(Point, 4326),
                destination_location GEOGRAPHY(Point, 4326),
                assigned_incident_id VARCHAR(50),
                battery_level       FLOAT DEFAULT 100.0,
                capabilities        JSONB DEFAULT '[]',
                driver_contact      VARCHAR(50),
                version             INT DEFAULT 1 NOT NULL,
                last_updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_resources_location ON resources USING GIST(current_location);
        `;
        await client.query(createTableQuery);
        console.log("[init-db] Table 'resources' created successfully!");

        const seedQuery = `
            INSERT INTO resources (resource_type, status, capabilities, driver_contact, current_location)
            SELECT *
            FROM (
                VALUES
                    ('POWER_GENERATOR_TRUCK', 'AVAILABLE', '["200KW", "HIGH_VOLTAGE"]'::jsonb, '089-111-2222',
                        ST_GeographyFromText('POINT(100.5018 13.7563)')),
                    ('AMBULANCE_VAN', 'AVAILABLE', '["AED", "OXYGEN"]'::jsonb, '081-234-5678',
                        ST_GeographyFromText('POINT(100.5200 13.7300)'))
            ) AS seed(resource_type, status, capabilities, driver_contact, current_location)
            WHERE NOT EXISTS (
                SELECT 1
                FROM resources existing
                WHERE existing.driver_contact = seed.driver_contact
            );
        `;
        await client.query(seedQuery);
        console.log('[init-db] Seed data inserted!');

    } catch (err) {
        console.error('[init-db] Error:', err.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

setupDatabase();

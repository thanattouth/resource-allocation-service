const { Client } = require('pg');
require('dotenv').config();

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
                incident_location   GEOGRAPHY(Point, 4326),
                destination_type    VARCHAR(50),
                destination_id      VARCHAR(100),
                destination_name    VARCHAR(255),
                assigned_incident_id VARCHAR(50),
                assigned_request_id VARCHAR(50),
                battery_level       FLOAT DEFAULT 100.0,
                capabilities        JSONB DEFAULT '[]',
                driver_contact      VARCHAR(50),
                version             INT DEFAULT 1 NOT NULL,
                last_updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_resources_location ON resources USING GIST(current_location);
        `;
        await client.query(createTableQuery);
        await client.query(`
            ALTER TABLE resources ADD COLUMN IF NOT EXISTS destination_type VARCHAR(50);
            ALTER TABLE resources ADD COLUMN IF NOT EXISTS destination_id VARCHAR(100);
            ALTER TABLE resources ADD COLUMN IF NOT EXISTS destination_name VARCHAR(255);
            ALTER TABLE resources ADD COLUMN IF NOT EXISTS assigned_request_id VARCHAR(50);
            ALTER TABLE resources ADD COLUMN IF NOT EXISTS incident_location GEOGRAPHY(Point, 4326);
        `);
        console.log("[init-db] Table 'resources' created successfully!");

        const seedQuery = `
            INSERT INTO resources (
                resource_type,
                capacity,
                status,
                capabilities,
                driver_contact,
                current_location,
                battery_level
            )
            SELECT
                seed.resource_type,
                seed.capacity,
                seed.status,
                seed.capabilities,
                seed.driver_contact,
                ST_GeographyFromText(seed.location_wkt),
                seed.battery_level
            FROM (
                VALUES
                    ('AMBULANCE_VAN', 4, 'AVAILABLE', '["AED", "OXYGEN"]'::jsonb, '081-234-5601', 'POINT(100.5200 13.7300)', 96.0),
                    ('AMBULANCE_VAN', 4, 'AVAILABLE', '["AED", "OXYGEN"]'::jsonb, '081-234-5602', 'POINT(100.5310 13.7420)', 94.0),
                    ('AMBULANCE_VAN', 2, 'AVAILABLE', '["BASIC_LIFE_SUPPORT"]'::jsonb, '081-234-5603', 'POINT(100.5420 13.7540)', 92.0),
                    ('AMBULANCE_VAN', 4, 'AVAILABLE', '["AED", "TRAUMA_KIT"]'::jsonb, '081-234-5604', 'POINT(100.5530 13.7660)', 97.0),
                    ('AMBULANCE_VAN', 2, 'AVAILABLE', '["OXYGEN", "CARDIAC_MONITOR"]'::jsonb, '081-234-5605', 'POINT(100.5640 13.7780)', 91.0),
                    ('AMBULANCE_VAN', 4, 'AVAILABLE', '["AED", "WHEELCHAIR_ACCESS"]'::jsonb, '081-234-5606', 'POINT(100.5750 13.7900)', 95.0),
                    ('AMBULANCE_VAN', 4, 'AVAILABLE', '["AED", "OXYGEN", "TRAUMA_KIT"]'::jsonb, '081-234-5607', 'POINT(100.5860 13.8020)', 93.0),
                    ('AMBULANCE_VAN', 2, 'AVAILABLE', '["NEONATAL_SUPPORT"]'::jsonb, '081-234-5608', 'POINT(100.5970 13.8140)', 90.0),

                    ('POWER_GENERATOR_TRUCK', 1, 'AVAILABLE', '["200KW", "HIGH_VOLTAGE"]'::jsonb, '089-111-2201', 'POINT(100.5018 13.7563)', 88.0),
                    ('POWER_GENERATOR_TRUCK', 1, 'AVAILABLE', '["100KW", "MEDIUM_VOLTAGE"]'::jsonb, '089-111-2202', 'POINT(100.5128 13.7683)', 86.0),
                    ('POWER_GENERATOR_TRUCK', 1, 'AVAILABLE', '["200KW", "HIGH_VOLTAGE", "CABLE_REEL"]'::jsonb, '089-111-2203', 'POINT(100.5238 13.7803)', 84.0),
                    ('POWER_GENERATOR_TRUCK', 1, 'AVAILABLE', '["50KW", "LOW_VOLTAGE"]'::jsonb, '089-111-2204', 'POINT(100.5348 13.7923)', 89.0),
                    ('POWER_GENERATOR_TRUCK', 1, 'AVAILABLE', '["100KW", "TRANSFORMER_KIT"]'::jsonb, '089-111-2205', 'POINT(100.5458 13.8043)', 87.0),
                    ('POWER_GENERATOR_TRUCK', 1, 'AVAILABLE', '["200KW", "FUEL_RESERVE"]'::jsonb, '089-111-2206', 'POINT(100.5568 13.8163)', 85.0),

                    ('RESCUE_BOAT', 6, 'AVAILABLE', '["FLOOD_RESCUE", "LIFE_JACKETS"]'::jsonb, '082-555-3301', 'POINT(100.4300 13.6400)', 78.0),
                    ('RESCUE_BOAT', 8, 'AVAILABLE', '["FLOOD_RESCUE", "MEDICAL_KIT"]'::jsonb, '082-555-3302', 'POINT(100.4420 13.6520)', 80.0),
                    ('RESCUE_BOAT', 6, 'AVAILABLE', '["SHALLOW_WATER", "LIFE_JACKETS"]'::jsonb, '082-555-3303', 'POINT(100.4540 13.6640)', 76.0),
                    ('RESCUE_BOAT', 10, 'AVAILABLE', '["FLOOD_RESCUE", "NIGHT_OPERATION"]'::jsonb, '082-555-3304', 'POINT(100.4660 13.6760)', 82.0),
                    ('RESCUE_BOAT', 8, 'AVAILABLE', '["FLOOD_RESCUE", "SUPPLY_DELIVERY"]'::jsonb, '082-555-3305', 'POINT(100.4780 13.6880)', 79.0),

                    ('HELICOPTER', 12, 'AVAILABLE', '["AIR_LIFT", "SEARCHLIGHT"]'::jsonb, '083-777-4401', 'POINT(100.6100 13.7000)', 72.0),
                    ('HELICOPTER', 8, 'AVAILABLE', '["MEDEVAC", "HOIST"]'::jsonb, '083-777-4402', 'POINT(100.6220 13.7120)', 75.0),
                    ('HELICOPTER', 10, 'AVAILABLE', '["AIR_LIFT", "SUPPLY_DROP"]'::jsonb, '083-777-4403', 'POINT(100.6340 13.7240)', 74.0),
                    ('HELICOPTER', 6, 'AVAILABLE', '["RECON", "NIGHT_OPERATION"]'::jsonb, '083-777-4404', 'POINT(100.6460 13.7360)', 73.0),

                    ('SUPPLY_TRUCK', 3000, 'AVAILABLE', '["FOOD", "WATER", "BULK_CARGO", "HEAVY_LOAD_SUPPLY"]'::jsonb, '084-888-5501', 'POINT(100.5200 13.6800)', 98.0),
                    ('SUPPLY_TRUCK', 2500, 'AVAILABLE', '["MEDICAL_SUPPLIES", "COLD_CHAIN", "HEAVY_LOAD_SUPPLY"]'::jsonb, '084-888-5502', 'POINT(100.5340 13.6920)', 96.0),
                    ('SUPPLY_TRUCK', 3500, 'AVAILABLE', '["RELIEF_KITS", "BULK_CARGO", "HEAVY_LOAD_SUPPLY"]'::jsonb, '084-888-5503', 'POINT(100.5480 13.7040)', 94.0),
                    ('SUPPLY_TRUCK', 2000, 'AVAILABLE', '["FOOD", "WATER", "LAST_MILE_DELIVERY", "LIGHT_LOAD_SUPPLY"]'::jsonb, '084-888-5504', 'POINT(100.5620 13.7160)', 97.0),
                    ('SUPPLY_TRUCK', 1800, 'AVAILABLE', '["BABY_SUPPLIES", "MEDICAL_SUPPLIES", "LIGHT_LOAD_SUPPLY"]'::jsonb, '084-888-5505', 'POINT(100.5760 13.7280)', 95.0)
            ) AS seed(resource_type, capacity, status, capabilities, driver_contact, location_wkt, battery_level)
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

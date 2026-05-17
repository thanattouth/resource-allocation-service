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

async function migrateSupplyTruckCapabilities() {
    try {
        await client.connect();
        console.log('[migrate] Connected to RDS successfully!');

        // Migration: Update existing SUPPLY_TRUCK resources based on capacity
        // capacity < 2500kg -> LIGHT_LOAD_SUPPLY
        // capacity >= 2500kg -> HEAVY_LOAD_SUPPLY
        const migrateQuery = `
            UPDATE resources
            SET capabilities = CASE
                WHEN capacity < 2500 THEN
                    capabilities || '["LIGHT_LOAD_SUPPLY"]'::jsonb
                ELSE
                    capabilities || '["HEAVY_LOAD_SUPPLY"]'::jsonb
            END,
            version = version + 1,
            last_updated_at = CURRENT_TIMESTAMP
            WHERE resource_type = 'SUPPLY_TRUCK'
            AND NOT (capabilities @> '["LIGHT_LOAD_SUPPLY"]'::jsonb 
                     OR capabilities @> '["HEAVY_LOAD_SUPPLY"]'::jsonb);
        `;

        const result = await client.query(migrateQuery);
        console.log(`[migrate] Updated ${result.rowCount} SUPPLY_TRUCK resources with LOAD_SUPPLY capabilities`);

        // Show summary
        const summaryQuery = `
            SELECT 
                resource_id,
                resource_type,
                capacity,
                capabilities
            FROM resources
            WHERE resource_type = 'SUPPLY_TRUCK'
            ORDER BY capacity DESC;
        `;
        const { rows } = await client.query(summaryQuery);
        
        console.log('\n[migrate] Current SUPPLY_TRUCK resources:');
        console.log('----------------------------------------');
        rows.forEach(row => {
            const loadType = row.capabilities.includes('HEAVY_LOAD_SUPPLY') ? 'HEAVY' : 
                           row.capabilities.includes('LIGHT_LOAD_SUPPLY') ? 'LIGHT' : 'NONE';
            console.log(`ID: ${row.resource_id}, Capacity: ${row.capacity}kg, Load: ${loadType}`);
        });
        console.log('----------------------------------------');

    } catch (err) {
        console.error('[migrate] Error:', err.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

migrateSupplyTruckCapabilities();

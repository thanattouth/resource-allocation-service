/**
 * Hospital Client - Integration with external Hospital API
 * Handles fetching nearby hospitals and creating transfer requests
 */

const HOSPITAL_API_BASE_URL = process.env.HOSPITAL_API_BASE_URL || 'https://3w10sext9e.execute-api.us-east-1.amazonaws.com';

/**
 * Fetch nearby hospitals from external API
 * @param {Object} params
 * @param {number} params.lat - Latitude
 * @param {number} params.lon - Longitude
 * @param {string} params.severityLevel - Severity level (low, medium, high)
 * @returns {Promise<Array>} Array of hospital objects
 */
async function getNearbyHospitals({ lat, lon, severityLevel = 'low' }) {
    const url = new URL(`${HOSPITAL_API_BASE_URL}/hospitals`);
    url.searchParams.append('lat', lat);
    url.searchParams.append('lon', lon);
    url.searchParams.append('severitylevel', severityLevel.toLowerCase());

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            },
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) {
            if (response.status === 404) {
                return [];
            }
            throw new Error(`Hospital API returned ${response.status}: ${response.statusText}`);
        }

        const hospitals = await response.json();
        
        if (!Array.isArray(hospitals)) {
            console.error('[hospitalClient] Invalid response format, expected array:', hospitals);
            return [];
        }

        return hospitals.map(h => ({
            hospitalId: h.hospitalId,
            name: h.name,
            status: h.status,
            lat: parseFloat(h.lat),
            lon: parseFloat(h.lon),
            address: h.address,
            availableBeds: h.availableBeds,
            availableICU: h.availableICU,
            availableEmergencyBed: h.availableEmergencyBed
        }));
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error('[hospitalClient] Request timeout fetching hospitals');
            throw new Error('Hospital API request timed out');
        }
        console.error('[hospitalClient] Error fetching hospitals:', error.message);
        throw error;
    }
}

/**
 * Find the best available hospital (first OPEN with available beds)
 * @param {Object} params
 * @param {number} params.lat - Latitude
 * @param {number} params.lon - Longitude
 * @param {string} params.severityLevel - Severity level
 * @returns {Promise<Object|null>} Best hospital or null if none available
 */
async function findBestHospital({ lat, lon, severityLevel = 'low' }) {
    try {
        const hospitals = await getNearbyHospitals({ lat, lon, severityLevel });
        
        if (hospitals.length === 0) {
            console.log('[hospitalClient] No hospitals found nearby');
            return null;
        }

        // Find first OPEN hospital with available beds
        const availableHospital = hospitals.find(h => 
            h.status === 'OPEN' && 
            (h.availableBeds > 0 || h.availableEmergencyBed > 0)
        );

        if (!availableHospital) {
            console.log('[hospitalClient] No available hospitals with open beds');
            return null;
        }

        return availableHospital;
    } catch (error) {
        console.error('[hospitalClient] Error finding best hospital:', error.message);
        return null;
    }
}

/**
 * Create a hospital transfer request
 * @param {Object} params
 * @param {string} params.incidentId - Incident ID
 * @param {string} params.hospitalId - Hospital ID from getNearbyHospitals
 * @param {string} params.severityLevel - Severity level (LOW, MEDIUM, HIGH)
 * @param {string} params.injuryDescription - Injury description
 * @param {number} params.lat - Latitude
 * @param {number} params.lon - Longitude
 * @param {string} params.requestedBy - Service name requesting the transfer
 * @returns {Promise<Object>} Transfer request response
 */
async function createTransferRequest({
    incidentId,
    hospitalId,
    severityLevel,
    injuryDescription,
    lat,
    lon,
    requestedBy = 'ResourceAllocationService'
}) {
    const url = `${HOSPITAL_API_BASE_URL}/transferrequests`;

    const payload = {
        incidentId: incidentId,
        hospitalId: hospitalId,
        severityLevel: severityLevel.toUpperCase(),
        injuryDescription: injuryDescription || 'Emergency transport from disaster scene',
        lat: lat,
        lon: lon,
        requestedBy: requestedBy
        // Note: conscious, bloodPressure, heartRate are excluded as per requirements
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`Transfer request failed: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        console.log('[hospitalClient] Transfer request created:', result);
        return result;
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('Transfer request API timed out');
        }
        console.error('[hospitalClient] Error creating transfer request:', error.message);
        throw error;
    }
}

module.exports = {
    getNearbyHospitals,
    findBestHospital,
    createTransferRequest
};

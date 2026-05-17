function getShelterLocatorBaseUrl() {
  return process.env.SHELTER_LOCATOR_BASE_URL || '';
}

function getShelterLocatorTimeoutMs() {
  return Number.parseInt(process.env.SHELTER_LOCATOR_TIMEOUT_MS || '5000', 10);
}

function buildNearbyShelterUrl({ latitude, longitude }) {
  const baseUrl = getShelterLocatorBaseUrl();
  if (!baseUrl) {
    return null;
  }

  const url = new URL('/v1/shelters/nearby', baseUrl);
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set('limit', '1');
  url.searchParams.set('radiusKm', '50');

  return url;
}

async function suggestNearbyShelter({ latitude, longitude, traceId, fetchImpl = fetch }) {
  const url = buildNearbyShelterUrl({ latitude, longitude });
  if (!url) {
    return {
      status: 'UNAVAILABLE',
      reason: 'Shelter Locator base URL is not configured.'
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getShelterLocatorTimeoutMs());

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-correlation-id': traceId
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        status: 'UNAVAILABLE',
        reason: `Shelter Locator returned HTTP ${response.status}.`
      };
    }

    const payload = await response.json();
    const shelter = payload?.items?.[0];

    if (!shelter) {
      return {
        status: 'UNAVAILABLE',
        reason: 'No shelter recommendation was returned.'
      };
    }

    return {
      status: 'FOUND',
      shelter: {
        shelter_id: shelter.shelterId,
        name: shelter.placeName || 'Unknown Shelter',
        location: {
          lat: shelter.lat ?? null,
          long: shelter.lng ?? null
        },
        shelter_status: shelter.occupancy || 'UNKNOWN',
        power_status: 'UNKNOWN'
      }
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      return {
        status: 'UNAVAILABLE',
        reason: 'Shelter Locator timed out.'
      };
    }

    return {
      status: 'UNAVAILABLE',
      reason: error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  suggestNearbyShelter
};

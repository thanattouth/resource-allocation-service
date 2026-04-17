const AVERAGE_RESPONSE_SPEED_KMH = 40;
const DEFAULT_POWERGRID_ETA_THRESHOLD_MINS = 2;

function calculateEstimatedArrivalTimeMinutes(distanceKm, averageSpeedKmh = AVERAGE_RESPONSE_SPEED_KMH) {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    return null;
  }

  if (!Number.isFinite(averageSpeedKmh) || averageSpeedKmh <= 0) {
    return null;
  }

  const etaMinutes = (distanceKm / averageSpeedKmh) * 60;
  return Math.max(1, Math.round(etaMinutes));
}

function calculateDistanceKm(origin, destination) {
  if (!origin || !destination) {
    return null;
  }

  const lat1 = Number(origin.lat);
  const lon1 = Number(origin.long);
  const lat2 = Number(destination.lat);
  const lon2 = Number(destination.long);

  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) {
    return null;
  }

  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}

function getPowerGridEtaThresholdMins() {
  const parsed = Number.parseInt(
    process.env.POWERGRID_ETA_UPDATE_THRESHOLD_MINS || `${DEFAULT_POWERGRID_ETA_THRESHOLD_MINS}`,
    10
  );

  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_POWERGRID_ETA_THRESHOLD_MINS;
}

function shouldPublishEtaUpdate(previousEtaMinutes, nextEtaMinutes, thresholdMins = getPowerGridEtaThresholdMins()) {
  if (!Number.isFinite(nextEtaMinutes) || nextEtaMinutes <= 0) {
    return false;
  }

  if (!Number.isFinite(previousEtaMinutes) || previousEtaMinutes <= 0) {
    return true;
  }

  return Math.abs(previousEtaMinutes - nextEtaMinutes) >= thresholdMins;
}

module.exports = {
  AVERAGE_RESPONSE_SPEED_KMH,
  DEFAULT_POWERGRID_ETA_THRESHOLD_MINS,
  calculateDistanceKm,
  calculateEstimatedArrivalTimeMinutes,
  getPowerGridEtaThresholdMins,
  shouldPublishEtaUpdate
};

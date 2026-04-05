const AVERAGE_RESPONSE_SPEED_KMH = 40;

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

module.exports = {
  AVERAGE_RESPONSE_SPEED_KMH,
  calculateEstimatedArrivalTimeMinutes
};

function normalizeIdentifier(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function resolveRequestIdentifiers({
  pathIncidentId,
  pathRequestId,
  bodyIncidentId,
  bodyRequestId
}) {
  const normalizedPathIncidentId = normalizeIdentifier(pathIncidentId);
  const normalizedPathRequestId = normalizeIdentifier(pathRequestId);
  const normalizedBodyIncidentId = normalizeIdentifier(bodyIncidentId);
  const normalizedBodyRequestId = normalizeIdentifier(bodyRequestId);
  const conflicts = [];

  if (
    normalizedPathIncidentId &&
    normalizedBodyIncidentId &&
    normalizedPathIncidentId !== normalizedBodyIncidentId
  ) {
    conflicts.push('incident_id');
  }

  if (
    normalizedPathRequestId &&
    normalizedBodyRequestId &&
    normalizedPathRequestId !== normalizedBodyRequestId
  ) {
    conflicts.push('request_id');
  }

  return {
    incidentId: normalizedPathIncidentId || normalizedBodyIncidentId,
    requestId: normalizedPathRequestId || normalizedBodyRequestId,
    conflicts
  };
}

function hasAnyRequestIdentifier({ incidentId, requestId }) {
  return Boolean(incidentId || requestId);
}

function toIdentifierPayload({ incidentId, requestId }) {
  return {
    ...(incidentId ? { incident_id: incidentId } : {}),
    ...(requestId ? { request_id: requestId } : {})
  };
}

function matchesAssignedIdentifiers(currentResource, { incidentId, requestId }) {
  if (incidentId && currentResource.assigned_incident_id !== incidentId) {
    return false;
  }

  if (requestId && currentResource.assigned_request_id !== requestId) {
    return false;
  }

  return true;
}

function buildIdentifierContext({ incidentId, requestId }) {
  return {
    incident_id: incidentId || null,
    request_id: requestId || null
  };
}

module.exports = {
  buildIdentifierContext,
  hasAnyRequestIdentifier,
  matchesAssignedIdentifiers,
  resolveRequestIdentifiers,
  toIdentifierPayload
};

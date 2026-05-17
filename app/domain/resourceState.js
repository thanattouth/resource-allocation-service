const { RESOURCE_STATUSES } = require('../utils/constants');

const ALLOWED_STATUS_TRANSITIONS = {
  AVAILABLE: ['EN_ROUTE'],
  EN_ROUTE: ['ON_SITE', 'AVAILABLE'],
  ON_SITE: ['TRANSPORTING', 'RETURNING', 'AVAILABLE', 'EN_ROUTE'],
  TRANSPORTING: ['RETURNING', 'AVAILABLE'],
  RETURNING: ['AVAILABLE'],
  ASSIGNED: ['EN_ROUTE']
};

function isValidStatus(status) {
  return RESOURCE_STATUSES.includes(status);
}

function canTransitionStatus(currentStatus, nextStatus) {
  if (!nextStatus || currentStatus === nextStatus) {
    return true;
  }

  if (!isValidStatus(currentStatus) || !isValidStatus(nextStatus)) {
    return false;
  }

  return (ALLOWED_STATUS_TRANSITIONS[currentStatus] || []).includes(nextStatus);
}

function validateStatusTransition(currentResource, nextStatus) {
  if (!nextStatus) {
    return null;
  }

  if (!isValidStatus(nextStatus)) {
    return {
      errorCode: 'INVALID_STATUS',
      message: `status must be one of: ${RESOURCE_STATUSES.join(', ')}`
    };
  }

  if (!canTransitionStatus(currentResource.status, nextStatus)) {
    return {
      errorCode: 'INVALID_STATUS_TRANSITION',
      message: `Cannot transition resource from ${currentResource.status} to ${nextStatus}.`
    };
  }

  if (nextStatus !== 'AVAILABLE' && !currentResource.assigned_incident_id && currentResource.status === 'AVAILABLE') {
    return {
      errorCode: 'RESOURCE_NOT_ASSIGNED',
      message: `Resource must be assigned to an incident before moving to ${nextStatus}.`
    };
  }

  if (nextStatus === 'TRANSPORTING' && currentResource.status !== 'ON_SITE') {
    return {
      errorCode: 'INVALID_STATUS_TRANSITION',
      message: 'Resource can move to TRANSPORTING only after reaching ON_SITE.'
    };
  }

  return null;
}

module.exports = {
  ALLOWED_STATUS_TRANSITIONS,
  canTransitionStatus,
  isValidStatus,
  validateStatusTransition
};

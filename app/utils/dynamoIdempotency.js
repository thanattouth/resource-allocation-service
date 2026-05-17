const {
  DynamoDBClient
} = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand
} = require('@aws-sdk/lib-dynamodb');
const { stableStringify } = require('./idempotency');

const DEFAULT_TTL_HOURS = 24;

let documentClient;

function toStorageSafeJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function getTableName() {
  const tableName = process.env.DYNAMODB_IDEMPOTENCY_TABLE;
  if (!tableName) {
    throw new Error('DYNAMODB_IDEMPOTENCY_TABLE is not configured.');
  }
  return tableName;
}

function getTtlHours() {
  const parsed = Number.parseInt(process.env.IDEMPOTENCY_TTL_HOURS || `${DEFAULT_TTL_HOURS}`, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_HOURS;
}

function getClient() {
  if (!documentClient) {
    const region = process.env.AWS_REGION || 'us-east-1';
    const client = new DynamoDBClient({ region });
    documentClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true
      }
    });
  }

  return documentClient;
}

async function claimIdempotencyRecord({ idempotencyKey, identifierContext, requestFingerprint }) {
  const client = getClient();
  const tableName = getTableName();
  const now = new Date();
  const expiresAt = Math.floor(now.getTime() / 1000) + (getTtlHours() * 60 * 60);
  const normalizedIdentifierContext = {
    incident_id: identifierContext?.incident_id || null,
    request_id: identifierContext?.request_id || null
  };

  try {
    await client.send(new PutCommand({
      TableName: tableName,
      Item: {
        idempotency_key: idempotencyKey,
        incident_id: normalizedIdentifierContext.incident_id,
        request_id: normalizedIdentifierContext.request_id,
        identifier_context: normalizedIdentifierContext,
        request_fingerprint: requestFingerprint,
        status: 'PROCESSING',
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        expires_at: expiresAt
      },
      ConditionExpression: 'attribute_not_exists(idempotency_key)'
    }));

    return { kind: 'CLAIMED' };
  } catch (error) {
    if (error.name !== 'ConditionalCheckFailedException') {
      throw error;
    }
  }

  const existing = await client.send(new GetCommand({
    TableName: tableName,
    Key: { idempotency_key: idempotencyKey },
    ConsistentRead: true
  }));

  const record = existing.Item;
  if (!record) {
    return { kind: 'RETRY' };
  }

  const existingIdentifierContext = {
    incident_id: record.identifier_context?.incident_id ?? record.incident_id ?? null,
    request_id: record.identifier_context?.request_id ?? record.request_id ?? null
  };

  if (
    record.request_fingerprint !== requestFingerprint ||
    stableStringify(existingIdentifierContext) !== stableStringify(normalizedIdentifierContext)
  ) {
    return { kind: 'CONFLICT' };
  }

  if (record.status === 'COMPLETED' && record.response_payload) {
    return {
      kind: 'REPLAY',
      responsePayload: record.response_payload
    };
  }

  return { kind: 'PROCESSING' };
}

async function completeIdempotencyRecord({ idempotencyKey, allocationId, responsePayload }) {
  const client = getClient();
  const tableName = getTableName();
  const now = new Date().toISOString();
  const storageSafePayload = toStorageSafeJson(responsePayload);

  await client.send(new UpdateCommand({
    TableName: tableName,
    Key: { idempotency_key: idempotencyKey },
    UpdateExpression: [
      'SET allocation_id = :allocationId,',
      'response_payload = :responsePayload,',
      '#status = :completed,',
      'updated_at = :updatedAt'
    ].join(' '),
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':allocationId': allocationId || null,
      ':responsePayload': storageSafePayload,
      ':completed': 'COMPLETED',
      ':updatedAt': now
    }
  }));
}

async function releaseIdempotencyRecord(idempotencyKey) {
  const client = getClient();
  const tableName = getTableName();

  await client.send(new DeleteCommand({
    TableName: tableName,
    Key: { idempotency_key: idempotencyKey }
  }));
}

module.exports = {
  claimIdempotencyRecord,
  completeIdempotencyRecord,
  releaseIdempotencyRecord
};

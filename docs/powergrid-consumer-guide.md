# PowerGrid Consumer Guide

This guide explains how `PowerGridService` should consume ETA update messages published by `ResourceAllocationService`.

## Current Integration Model

In the current AWS Learner Lab deployment, `ResourceAllocationService` publishes directly to an Amazon SQS queue:

- Logical event channel: `resource.events.powergrid_eta_updated`
- Physical queue: `resource-events-powergrid-eta-updated`

This means `PowerGridService` does **not** subscribe to a broker topic in the Kafka/SNS sense right now. Instead, it acts as an SQS consumer and polls the queue directly.

## What PowerGrid Receives

`PowerGridService` receives an event when:

- a resource is successfully allocated for a `POWER_NODE`
- the resource is still `EN_ROUTE` and the ETA changes by more than the configured threshold

The message payload follows this structure:

```json
{
  "event_id": "0bd2ec65-d52f-42df-898b-a46dba26cecb",
  "event_type": "RESOURCE_ETA_UPDATED",
  "timestamp": "2026-04-17T09:13:14.005Z",
  "incident_id": "INC-2026-E2E-0001",
  "allocation_id": "ALLOC-1776417193993",
  "source_service": "ResourceAllocationService",
  "resource": {
    "resource_id": "be0f025a-da8b-440c-b088-b1672c9c3a24",
    "resource_type": "AMBULANCE_VAN"
  },
  "destination": {
    "destination_type": "POWER_NODE",
    "destination_id": "NODE-77"
  },
  "status": "ASSIGNED",
  "eta_minutes": 3
}
```

Message attributes may also include:

- `x-correlation-id`
- `content-type`

## Expected Consumer Behavior

`PowerGridService` should:

1. Call `ReceiveMessage` on the queue using long polling
2. Parse `MessageBody` as JSON
3. Validate that `event_type === "RESOURCE_ETA_UPDATED"`
4. Use `incident_id`, `resource.resource_id`, `destination.destination_id`, `status`, and `eta_minutes` to update its own internal state
5. Treat `event_id` as a deduplication key
6. Delete the message from the queue only after successful processing

Because Amazon SQS is **at-least-once delivery**, duplicate messages are possible. The consumer must be idempotent.

## Required Configuration

Example environment variables for `PowerGridService`:

```bash
AWS_REGION=us-east-1
SQS_POWERGRID_ETA_UPDATED_URL=https://sqs.us-east-1.amazonaws.com/<account-id>/resource-events-powergrid-eta-updated
```

The runtime must also have AWS credentials or an IAM role with permission to:

- `sqs:ReceiveMessage`
- `sqs:DeleteMessage`
- `sqs:GetQueueAttributes`

## Example: AWS CLI

To inspect messages manually:

```bash
aws sqs receive-message \
  --queue-url "$SQS_POWERGRID_ETA_UPDATED_URL" \
  --max-number-of-messages 5 \
  --wait-time-seconds 10 \
  --message-attribute-names All
```

## Example: Node.js Consumer

```js
const {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand
} = require('@aws-sdk/client-sqs');

const client = new SQSClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

const queueUrl = process.env.SQS_POWERGRID_ETA_UPDATED_URL;

async function processPowerGridEvent(event) {
  if (event.event_type !== 'RESOURCE_ETA_UPDATED') {
    return;
  }

  // Example domain action:
  // update the PowerGrid incident/resource ETA board
  console.log('ETA update received:', {
    incidentId: event.incident_id,
    resourceId: event.resource.resource_id,
    destinationId: event.destination.destination_id,
    status: event.status,
    etaMinutes: event.eta_minutes
  });
}

async function pollQueueForever() {
  while (true) {
    const result = await client.send(new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 5,
      WaitTimeSeconds: 10,
      MessageAttributeNames: ['All']
    }));

    const messages = result.Messages || [];

    for (const message of messages) {
      try {
        const payload = JSON.parse(message.Body);

        // Recommended: deduplicate by payload.event_id here
        await processPowerGridEvent(payload);

        await client.send(new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: message.ReceiptHandle
        }));
      } catch (error) {
        console.error('Failed to process PowerGrid ETA event:', error.message);
        // Do not delete the message if processing failed.
        // It can be retried or eventually moved to DLQ depending on queue configuration.
      }
    }
  }
}

pollQueueForever().catch((error) => {
  console.error('PowerGrid consumer crashed:', error);
  process.exit(1);
});
```

## Implementation Notes

- Long polling is preferred over rapid short polling to reduce empty responses and cost
- The consumer should log `x-correlation-id` when present for cross-service tracing
- The consumer should keep its own deduplication mechanism keyed by `event_id`
- The consumer should not assume every ETA change is large; some events are intentionally filtered by the producer threshold

## Summary

Today, `PowerGridService` should integrate by consuming the SQS queue directly. If the architecture later evolves to SNS fan-out or a true broker topic, the integration model can be updated, but for the current deployment the correct model is:

`ResourceAllocationService -> SQS queue -> PowerGridService consumer`

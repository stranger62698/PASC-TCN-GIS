import { QueueClient, type MessageMetadata } from "@vercel/queue";
import {
  PASC_LARGE_MAX_ATTEMPTS,
  PASC_LARGE_TOPIC,
  markPascLargeRetry,
  processPascLargeMessage,
  type PascLargeEnqueue,
  type PascLargeMessage,
} from "../server/pasc-large-jobs.js";

const queue = new QueueClient({ region: "iad1" });
const enqueue: PascLargeEnqueue = async (message, idempotencyKey, delaySeconds = 0) => {
  await queue.send(PASC_LARGE_TOPIC, message, { idempotencyKey, retentionSeconds: 604800, delaySeconds });
};

async function consume(message: PascLargeMessage, metadata: MessageMetadata) {
  try {
    await processPascLargeMessage(message, metadata.deliveryCount, enqueue);
  } catch (error) {
    await markPascLargeRetry(message, metadata.deliveryCount, error);
    throw error;
  }
}

export default queue.handleNodeCallback<PascLargeMessage>(consume, {
  visibilityTimeoutSeconds: 300,
  retry: (_error, metadata) => metadata.deliveryCount >= PASC_LARGE_MAX_ATTEMPTS
    ? { acknowledge: true }
    : { afterSeconds: Math.min(900, 15 * 2 ** Math.max(0, metadata.deliveryCount - 1)) },
});
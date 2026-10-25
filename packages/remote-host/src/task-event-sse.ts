import type { TaskEventStreamFrame } from "@openducktor/contracts";
import type { TaskEventLeaseManager } from "./task-event-leases";
import { startStreamHeartbeat } from "./stream-heartbeat";
const TASK_SSE_READY_COMMENT = new TextEncoder().encode(": openducktor-ready\n\n");
export const writeTaskFrameSseEvent = (frame: TaskEventStreamFrame): Uint8Array => {
  const { cursor } = frame;
  return new TextEncoder().encode(
    [
      `id: ${cursor.epoch}:${cursor.sequence}`,
      "event: task-frame",
      `data: ${JSON.stringify(frame)}`,
      "",
      "",
    ].join("\n"),
  );
};

export const createTaskEventSseResponse = (
  leaseManager: TaskEventLeaseManager,
  subscriptionId: string,
  corsHeaders: HeadersInit,
  signal: AbortSignal,
): Response => {
  let generation = 0;
  let stopHeartbeat: (() => void) | null = null;
  const detach = (): void => {
    signal.removeEventListener("abort", detach);
    stopHeartbeat?.();
    const lease = leaseManager.get(subscriptionId);
    if (lease) leaseManager.detach(lease, generation);
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const lease = leaseManager.get(subscriptionId);
      if (!lease) {
        controller.error(new Error("Task event stream lease was released before connection."));
        return;
      }
      controller.enqueue(TASK_SSE_READY_COMMENT);
      generation = leaseManager.attach(lease, controller);
      stopHeartbeat = startStreamHeartbeat(controller);
      signal.addEventListener("abort", detach, { once: true });
      if (signal.aborted) detach();
    },
    pull() {
      const lease = leaseManager.get(subscriptionId);
      if (lease) leaseManager.resume(lease, generation);
    },
    cancel: detach,
  });
  return new Response(body, {
    headers: {
      ...corsHeaders,
      "cache-control": "no-cache",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
    },
  });
};

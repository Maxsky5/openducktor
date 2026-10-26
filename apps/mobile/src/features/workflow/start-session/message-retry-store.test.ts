import { describe, expect, test } from "bun:test";
import type { SessionStartMessageRetry } from "@openducktor/frontend-core/sessions/start/session-start-message-retry";
import { createFeedbackFake } from "@openducktor/frontend-core/test-support/feedback-fake";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import {
  createMessageRetryStore,
  messageRetryStoreOf,
  reportMessageRetry,
} from "./message-retry-store";

const retryThat = (next: () => SessionStartMessageRetry | null): SessionStartMessageRetry => ({
  kind: "failed",
  title: "Session started, but the first message failed.",
  description: "The runtime closed the connection.",
  actionLabel: "Retry message",
  retry: async () => next(),
});

describe("message retry store", () => {
  test("keeps a retry for its task until the message reaches the session", async () => {
    const store = createMessageRetryStore();
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    store.add(
      "TASK-1",
      retryThat(() => null),
    );
    const [entry] = store.forTask("TASK-1");
    expect(entry?.retry.kind).toBe("failed");
    expect(store.forTask("TASK-2")).toHaveLength(0);
    if (!entry) throw new Error("The retry is missing.");
    await store.retry(entry.id);
    expect(store.forTask("TASK-1")).toHaveLength(0);
    expect(notified).toBeGreaterThan(1);
  });

  test("keeps the next retry with the new cause when the send fails again", async () => {
    const store = createMessageRetryStore();
    const again = retryThat(() => null);
    store.add(
      "TASK-1",
      retryThat(() => ({ ...again, description: "Still offline." })),
    );
    const [entry] = store.forTask("TASK-1");
    if (!entry) throw new Error("The retry is missing.");
    await store.retry(entry.id);
    expect(store.forTask("TASK-1")[0]?.retry.description).toBe("Still offline.");
    expect(store.forTask("TASK-1")[0]?.pending).toBe(false);
  });

  test("keeps a lost send result as unknown and never sends it again", async () => {
    const store = createMessageRetryStore();
    let sends = 0;
    store.add(
      "TASK-1",
      retryThat(() => {
        sends += 1;
        return { kind: "unknown", title: "Result unknown", description: "Check the transcript." };
      }),
    );
    const [entry] = store.forTask("TASK-1");
    if (!entry) throw new Error("The retry is missing.");
    await store.retry(entry.id);
    expect(store.forTask("TASK-1")[0]?.retry).toEqual({
      kind: "unknown",
      title: "Result unknown",
      description: "Check the transcript.",
    });
    await store.retry(entry.id);
    expect(sends).toBe(1);
  });

  test("returns the same list until the retries change", () => {
    const store = createMessageRetryStore();
    store.add(
      "TASK-1",
      retryThat(() => null),
    );
    expect(store.forTask("TASK-1")).toBe(store.forTask("TASK-1"));
    const [entry] = store.forTask("TASK-1");
    if (entry) store.dismiss(entry.id);
    expect(store.forTask("TASK-1")).toHaveLength(0);
  });

  test("reports a failed first message with the task that offers the retry", () => {
    const feedback = createFeedbackFake();
    const connection = createTestClientConnection({ feedback });

    reportMessageRetry(
      connection,
      "TASK-1",
      retryThat(() => null),
    );

    expect(messageRetryStoreOf(connection).forTask("TASK-1")).toHaveLength(1);
    expect(feedback.shownOf("error")).toEqual([
      {
        kind: "error",
        message: "Session started, but the first message failed.",
        options: {
          description: "The runtime closed the connection. Open TASK-1 to retry the message.",
        },
      },
    ]);
  });
});

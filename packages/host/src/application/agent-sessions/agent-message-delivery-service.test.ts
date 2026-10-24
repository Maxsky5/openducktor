import { describe, expect, test } from "bun:test";
import type { AgentSessionLiveEnvelope } from "@openducktor/contracts";
import { HostOperationError } from "../../effect/host-errors";
import {
  acceptedThenFailed,
  createHarness,
  failureOf,
  foregroundEnd,
  ref,
  sessionState,
  target,
  turnEnd,
  turnError,
} from "./test-support/agent-message-delivery-harness";

describe("agent message delivery: submit and drain", () => {
  test("drains after an automatic foreground turn while background work stays running", async () => {
    const h = createHarness();
    h.upsertSession({ activity: "running", foregroundTurnActive: true });
    h.outcomes.push("busy", "busy");
    await h.submit("first");
    await h.submit("second");

    h.service.observeChanges([foregroundEnd()]);
    await h.runBackground();
    expect(h.sentTexts()).toEqual(["first:new_turn"]);

    h.upsertSession({ activity: "running", foregroundTurnActive: false });
    await h.runBackground();
    expect(h.queueTexts()).toEqual(["first:queued", "second:queued"]);
    expect(h.pause()).toBeNull();

    h.upsertSession({ activity: "running", foregroundTurnActive: true });
    h.service.observeChanges([foregroundEnd()]);
    h.upsertSession({ activity: "running", foregroundTurnActive: false });
    await h.runBackground();
    expect(h.sentTexts()).toEqual(["first:new_turn", "first:new_turn", "first:new_turn"]);
    expect(h.queueTexts()).toEqual(["second:queued"]);
  });

  test("waits for available foreground state and blocking input before queue delivery", async () => {
    const h = createHarness();
    h.outcomes.push("busy");
    await h.submit("first");
    h.upsertSession({
      activity: "running",
      foregroundTurnActive: false,
      statusUnavailableReason: "Claude connection lost. Reconnect the session.",
    });
    h.service.observeChanges([foregroundEnd()]);
    await h.runBackground();
    expect(h.sentTexts()).toEqual(["first:new_turn"]);
    h.upsertSession({ activity: "running", foregroundTurnActive: true });
    await h.runBackground();
    expect(h.sentTexts()).toEqual(["first:new_turn"]);
    h.upsertSession({
      activity: "waiting_for_permission",
      foregroundTurnActive: false,
      // A child owns the request. Its parent carries only the waiting activity.
      blocked: false,
    });
    await h.runBackground();
    expect(h.sentTexts()).toEqual(["first:new_turn"]);
    h.upsertSession({ activity: "running", foregroundTurnActive: false });
    await h.runBackground();
    expect(h.sentTexts()).toEqual(["first:new_turn", "first:new_turn"]);
  });

  test.each(["failed", "interrupted"] as const)(
    "keeps a queue paused after an automatic %s turn and later foreground updates",
    async (outcome) => {
      const h = createHarness();
      h.outcomes.push("busy");
      await h.submit("first");
      h.upsertSession({ activity: "running", foregroundTurnActive: true });
      h.service.observeChanges([foregroundEnd(outcome)]);
      h.upsertSession({ activity: "running", foregroundTurnActive: false });
      await h.runBackground();
      expect(h.sentTexts()).toEqual(["first:new_turn"]);
      expect(h.pause()).toContain(outcome === "failed" ? "turn failed" : "turn was interrupted");
      await h.manage({ kind: "resume" });
      await h.runBackground();
      expect(h.queueTexts()).toEqual([]);
    },
  );

  test("does not retain an automatic turn failure when no message waits", async () => {
    const h = createHarness();
    h.service.observeChanges([foregroundEnd("failed")]);
    h.upsertSession({ activity: "running", foregroundTurnActive: false });
    expect(await h.submit("later")).toMatchObject({ kind: "accepted" });
    expect(h.service.listQueues("/repo")).toEqual([]);
  });

  test("starts a turn at once when the session is idle and has no queue", async () => {
    const harness = createHarness();

    const result = await harness.submit("first");

    expect(result).toMatchObject({ kind: "accepted", acceptedMessage: { message: "first" } });
    expect(harness.calls).toEqual([
      {
        input: expect.objectContaining({ repoPath: "/repo", delivery: "new_turn" }),
      },
    ]);
    expect(harness.service.listQueues("/repo")).toEqual([]);
    expect(harness.envelopes).toEqual([]);
  });

  test("queues a message that the runtime refuses because a turn runs", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy");

    const result = await harness.submit("first");

    expect(result).toMatchObject({
      kind: "queued",
      queue: { target, entries: [{ submissionId: "submission-first", state: "queued" }] },
    });
    expect(harness.queueTexts()).toEqual(["first:queued"]);
    expect(harness.envelopes.map((envelope) => envelope.type)).toEqual(["message_queue_updated"]);
  });

  test("adds later messages behind the queue without sending them", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    await harness.submit("first");

    const result = await harness.submit("second");

    expect(result.kind).toBe("queued");
    expect(harness.sentTexts()).toEqual(["first:new_turn"]);
    expect(harness.queueTexts()).toEqual(["first:queued", "second:queued"]);
  });

  test("sends one queued message for each completed turn in order", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    await harness.submit("first");
    await harness.submit("second");

    harness.idle();
    await harness.runBackground();

    expect(harness.sentTexts()).toEqual(["first:new_turn", "first:new_turn"]);
    expect(harness.calls[1]?.input).not.toHaveProperty("model");
    expect(harness.queueTexts()).toEqual(["second:queued"]);

    harness.idle();
    await harness.runBackground();

    expect(harness.sentTexts()).toEqual(["first:new_turn", "first:new_turn", "second:new_turn"]);
    expect(harness.service.listQueues("/repo")).toEqual([]);
  });

  test("keeps the first message queued while the runtime still reports work", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy", "busy");
    await harness.submit("first");

    harness.idle();
    await harness.runBackground();

    expect(harness.sentTexts()).toEqual(["first:new_turn", "first:new_turn"]);
    expect(harness.queueTexts()).toEqual(["first:queued"]);
    expect(harness.pause()).toBeNull();
  });

  test("tries again when the session becomes idle during a refused delivery", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy", "busy");
    await harness.submit("first");
    harness.setOnSend(() => {
      harness.setOnSend(() => {});
      harness.idle();
    });

    harness.idle();
    await harness.runBackground();

    expect(harness.sentTexts()).toEqual(["first:new_turn", "first:new_turn", "first:new_turn"]);
    expect(harness.service.listQueues("/repo")).toEqual([]);
  });

  test("delivers the next message when the turn ends while a send still waits for its answer", async () => {
    const harness = createHarness();
    harness.setOnSend(() => {
      harness.setOnSend(() => {});
      // A message queues during the send, then the session reports idle before the send returns.
      void harness.submit("second");
      harness.idle();
    });

    await harness.submit("first");
    await harness.runBackground();

    expect(harness.sentTexts()).toEqual(["first:new_turn", "second:new_turn"]);
    expect(harness.service.listQueues("/repo")).toEqual([]);
  });

  test("keeps a message paused when the agent stops while its send waits for an answer", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    harness.setOnSend(() => {
      harness.setOnSend(() => {});
      harness.stop();
      harness.idle();
    });

    await harness.submit("first");
    await harness.runBackground();

    expect(harness.sentTexts()).toEqual(["first:new_turn"]);
    expect(harness.queueTexts()).toEqual(["first:queued"]);
    expect(harness.pause()).toBe(
      "You stopped the agent. Resume the queue to send the next message.",
    );
  });

  test("forgets a pause that only protected a send that then failed", async () => {
    const harness = createHarness();
    harness.outcomes.push(new HostOperationError({ operation: "test", message: "Offline." }));
    harness.setOnSend(() => {
      harness.setOnSend(() => {});
      harness.stop();
    });

    await failureOf(harness.submit("first"));

    expect(harness.service.listQueues("/repo")).toEqual([]);
  });

  test.each([
    {
      turn: "a turn error, even with a completed turn in the same batch",
      changes: [turnError("Model overloaded."), turnEnd("completed")],
      pause:
        "The agent stopped with an error: Model overloaded. Resume the queue to send the next message.",
    },
    {
      turn: "an interrupted turn",
      changes: [turnEnd(), turnEnd("interrupted")],
      pause: "The turn was interrupted. Resume the queue to send the next message.",
    },
    {
      turn: "a failed turn",
      changes: [turnEnd("failed")],
      pause: "The turn failed. Resume the queue to send the next message.",
    },
  ])("pauses the queue after $turn until the user resumes it", async ({ changes, pause }) => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    await harness.submit("first");

    harness.service.observeChanges(changes);
    await harness.runBackground();

    expect(harness.sentTexts()).toEqual(["first:new_turn"]);
    expect(harness.pause()).toBe(pause);

    await harness.manage({ kind: "resume" });
    await harness.runBackground();

    expect(harness.sentTexts()).toEqual(["first:new_turn", "first:new_turn"]);
    expect(harness.service.listQueues("/repo")).toEqual([]);
  });

  test("keeps a stopped session queue paused until the user resumes it", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    await harness.submit("first");

    // The stop names the repository through a link to it.
    harness.stop({ ...ref, repoPath: "/repo-link" });
    harness.idle();
    await harness.runBackground();
    await harness.submit("second");

    expect(harness.sentTexts()).toEqual(["first:new_turn"]);
    expect(harness.pause()).toBe(
      "You stopped the agent. Resume the queue to send the next message.",
    );
    expect(harness.queueTexts()).toEqual(["first:queued", "second:queued"]);
  });

  test("keeps a failed queued message in place with its cause and pauses delivery", async () => {
    const harness = createHarness();
    harness.outcomes.push(
      "busy",
      new HostOperationError({ operation: "test", message: "Runtime is not ready." }),
    );
    await harness.submit("first");
    await harness.submit("second");

    harness.idle();
    await harness.runBackground();

    expect(harness.service.listQueues("/repo")[0]?.entries[0]).toMatchObject({
      submissionId: "submission-first",
      state: "queued",
      error: "Runtime is not ready.",
    });
    expect(harness.pause()).toBe(
      "Delivery failed: Runtime is not ready. Resume the queue to try again.",
    );
    expect(harness.queueTexts()).toEqual(["first:queued", "second:queued"]);
  });

  test("removes a queued message that the agent received before a later update failed", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    await harness.submit("first");
    await harness.submit("second");
    harness.outcomes.push(acceptedThenFailed("first", "new_turn"));

    harness.idle();
    await harness.runBackground();

    expect(harness.queueTexts()).toEqual(["second:queued"]);
    expect(harness.pause()).toContain("The agent received the message, but a later update failed");
  });

  test("pauses later messages when a direct send reached the agent before a later failure", async () => {
    const harness = createHarness();
    harness.outcomes.push(acceptedThenFailed("now", "new_turn"));
    let later: Promise<unknown> | null = null;
    harness.setOnSend(() => {
      harness.setOnSend(() => {});
      later = harness.submit("later");
    });

    await failureOf(harness.submit("now"));
    await later;
    await harness.runBackground();

    expect(harness.sentTexts()).toEqual(["now:new_turn"]);
    expect(harness.queueTexts()).toEqual(["later:queued"]);
    expect(harness.pause()).toContain("The agent received the message, but a later update failed");
  });

  test("puts a refused in-flight message ahead of messages queued meanwhile", async () => {
    const harness = createHarness();
    let second: Promise<unknown> | null = null;
    harness.outcomes.push("busy");
    harness.setOnSend(() => {
      harness.setOnSend(() => {});
      second = harness.submit("second");
    });

    await harness.submit("first");
    await second;

    expect(harness.sentTexts()).toEqual(["first:new_turn"]);
    expect(harness.queueTexts()).toEqual(["first:queued", "second:queued"]);
  });

  test("returns a failed immediate send to the caller and forgets the empty queue", async () => {
    const harness = createHarness();
    harness.outcomes.push(new HostOperationError({ operation: "test", message: "Offline." }));

    const failure = await failureOf(harness.submit("first"));

    expect(failure).toMatchObject({ message: "Offline." });
    expect(harness.service.listQueues("/repo")).toEqual([]);
    expect(harness.envelopes).toEqual([]);
  });

  test.each<[string, AgentSessionLiveEnvelope]>([
    ["a removal", { type: "session_removed", ref }],
    // A repository snapshot lists every live session, so it also reports a lost session.
    [
      "a repository snapshot without it",
      { type: "snapshot", repoPath: "/repo", messageQueues: [], sessions: [] },
    ],
  ])("pauses a queue whose session left the runtime, reported by %s", async (_, change) => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    await harness.submit("first");
    harness.upsertSession({ activity: "running" });

    harness.service.observeChanges([change]);

    expect(harness.pause()).toBe(
      "The session is not running in its runtime. Reopen the session, then resume the queue.",
    );

    harness.stop();
    expect(harness.pause()).toBe(
      "The session is not running in its runtime. Reopen the session, then resume the queue.",
    );
  });

  test("orders snapshots with one revision sequence across queue changes", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    await harness.submit("first");
    await harness.manage({ kind: "remove", submissionId: "submission-first" });
    harness.outcomes.push("busy");
    await harness.submit("again");

    const revisions = harness.envelopes.flatMap((envelope) =>
      envelope.type === "message_queue_updated" ? [envelope.queue.revision] : [],
    );
    expect(revisions).toEqual([1, 2, 3]);
  });

  test("waits for blocking input and delivers after the answer", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    await harness.submit("first");
    harness.upsertSession({ activity: "waiting_for_permission", blocked: true });

    const steerFailure = await failureOf(
      harness.manage({ kind: "steer", submissionId: "submission-first" }),
    );
    const submitFailure = await failureOf(harness.submit("now", "steer"));
    harness.idle();
    await harness.runBackground();

    expect(steerFailure?.message).toContain("pending request");
    expect(submitFailure?.message).toContain("pending request");
    expect(harness.sentTexts()).toEqual(["first:new_turn"]);
    expect(harness.queueTexts()).toEqual(["first:queued"]);
    expect(harness.pause()).toBeNull();

    harness.upsertSession({ activity: "idle" });
    await harness.runBackground();

    expect(harness.sentTexts()).toEqual(["first:new_turn", "first:new_turn"]);
    expect(harness.queueTexts()).toEqual([]);
  });

  test("delivers after the turn that an answer continues", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    await harness.submit("first");
    harness.upsertSession({ activity: "waiting_for_permission", blocked: true });
    harness.idle();
    await harness.runBackground();

    harness.upsertSession({ activity: "running" });
    await harness.runBackground();
    expect(harness.sentTexts()).toEqual(["first:new_turn"]);
    expect(harness.queueTexts()).toEqual(["first:queued"]);

    harness.idle();
    await harness.runBackground();
    expect(harness.sentTexts()).toEqual(["first:new_turn", "first:new_turn"]);
    expect(harness.queueTexts()).toEqual([]);
  });

  test("reads the session activity of a refresh snapshot, so Resume delivers to an idle session", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    await harness.submit("first");
    harness.upsertSession({ activity: "running" });
    harness.stop();
    harness.service.observeChanges([
      {
        type: "snapshot",
        repoPath: "/repo",
        messageQueues: [],
        sessions: [sessionState({ activity: "idle" })],
      },
    ]);

    await harness.manage({ kind: "resume" });
    await harness.runBackground();

    expect(harness.sentTexts()).toEqual(["first:new_turn", "first:new_turn"]);
    expect(harness.queueTexts()).toEqual([]);
  });
});

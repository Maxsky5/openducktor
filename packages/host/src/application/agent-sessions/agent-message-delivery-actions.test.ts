import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import {
  acceptedThenFailed,
  createHarness,
  type DeliveryHarness,
  editIdOf,
  failureOf,
  model,
  ref,
  slashCommand,
  target,
} from "./test-support/agent-message-delivery-harness";

describe("agent message delivery: queue actions and steering", () => {
  test("holds an edited first message and lets the save replace its content in place", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    await harness.submit("first");
    await harness.submit("second");

    const editing = await harness.manage({ kind: "begin_edit", submissionId: "submission-first" });
    const editId = editIdOf(editing.queue.entries[0]);
    harness.idle();
    await harness.runBackground();
    expect(harness.sentTexts()).toEqual(["first:new_turn"]);
    expect(harness.queueTexts()).toEqual(["first:editing", "second:queued"]);

    const failure = await failureOf(
      harness.manage({ kind: "steer", submissionId: "submission-first" }),
    );
    expect(failure).toMatchObject({ message: "Save or cancel the edit of this message first." });

    await harness.manage({
      kind: "save_edit",
      submissionId: "submission-first",
      editId,
      parts: [{ kind: "text", text: "edited" }],
    });
    await harness.runBackground();

    expect(harness.sentTexts()).toEqual(["first:new_turn", "edited:new_turn"]);
    expect(harness.queueTexts()).toEqual(["second:queued"]);
  });

  test("rejects a Save or Cancel from an edit that already ended", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    await harness.submit("first");
    const firstEdit = await harness.manage({
      kind: "begin_edit",
      submissionId: "submission-first",
    });
    const staleEditId = editIdOf(firstEdit.queue.entries[0]);
    await harness.manage({
      kind: "cancel_edit",
      submissionId: "submission-first",
      editId: staleEditId,
    });
    const secondEdit = await harness.manage({
      kind: "begin_edit",
      submissionId: "submission-first",
    });

    const staleSave = await failureOf(
      harness.manage({
        kind: "save_edit",
        submissionId: "submission-first",
        editId: staleEditId,
        parts: [{ kind: "text", text: "old draft" }],
      }),
    );
    const staleCancel = await failureOf(
      harness.manage({
        kind: "cancel_edit",
        submissionId: "submission-first",
        editId: staleEditId,
      }),
    );

    expect(staleSave?.message).toContain("This edit ended or changed elsewhere");
    expect(staleCancel?.message).toContain("This edit ended or changed elsewhere");
    expect(harness.service.listQueues("/repo")[0]?.entries[0]).toMatchObject({
      state: "editing",
      editId: editIdOf(secondEdit.queue.entries[0]),
      parts: [{ kind: "text", text: "first" }],
    });
  });

  test("removes only the selected message and never sends it", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    await harness.submit("first");
    await harness.submit("second");

    await harness.manage({ kind: "remove", submissionId: "submission-first" });
    await harness.runBackground();

    expect(harness.sentTexts()).toEqual(["first:new_turn", "second:new_turn"]);
    expect(harness.service.listQueues("/repo")).toEqual([]);
  });

  test("refuses an action that names another session scope than the owner of the queue", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    await harness.submit("first");

    const failure = await failureOf(
      Effect.runPromise(
        harness.service.manage({
          ...target,
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          action: { kind: "remove", submissionId: "submission-first" },
        }),
      ),
    );

    expect(failure?.message).toContain("belongs to another chat");
    expect(harness.queueTexts()).toEqual(["first:queued"]);
  });

  test("keeps the other messages unchanged when the user removes one while the agent works", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    await harness.submit("first");
    await harness.submit("second");
    await harness.submit("third");
    harness.upsertSession({ activity: "running" });
    const published = harness.envelopes.length;

    await harness.manage({ kind: "remove", submissionId: "submission-second" });
    await harness.runBackground();

    // A new turn would fail while the turn runs, so the host does not try one.
    expect(harness.sentTexts()).toEqual(["first:new_turn"]);
    expect(harness.envelopes.slice(published)).toHaveLength(1);
    expect(harness.queueTexts()).toEqual(["first:queued", "third:queued"]);

    harness.idle();
    await harness.runBackground();
    expect(harness.sentTexts()).toEqual(["first:new_turn", "first:new_turn"]);
  });

  test("refuses to edit or remove a message whose delivery started", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    await harness.submit("first");
    let removal: Promise<Error | null> | null = null;
    harness.setOnSend(() => {
      removal = failureOf(harness.manage({ kind: "remove", submissionId: "submission-first" }));
    });

    harness.idle();
    await harness.runBackground();

    expect(await removal).toMatchObject({ message: "Delivery of this message already started." });
    expect(harness.service.listQueues("/repo")).toEqual([]);
  });

  test("keeps a pause while blocking input or an unavailable session remains", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    await harness.submit("first");
    harness.stop();

    harness.upsertSession({ activity: "waiting_for_permission", blocked: true });
    const blockedResume = await failureOf(harness.manage({ kind: "resume" }));
    expect(blockedResume?.message).toContain("pending request");
    expect(harness.pause()).toContain("You stopped the agent");

    harness.upsertSession({ activity: "running" });
    harness.service.observeChanges([{ type: "session_removed", ref }]);
    const removedResume = await failureOf(harness.manage({ kind: "resume" }));
    expect(removedResume).toBeNull();

    harness.upsertSession({ activity: "idle" });
    await harness.manage({ kind: "resume" });
    await harness.runBackground();
    expect(harness.pause()).toBeNull();
    expect(harness.sentTexts()).toEqual(["first:new_turn", "first:new_turn"]);
  });

  test("steers one queued message with its captured model and keeps the paused remainder", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    await harness.submit("first");
    await harness.submit("second");
    harness.stop();

    harness.upsertSession({ activity: "running" });
    const result = await harness.manage({ kind: "steer", submissionId: "submission-second" });

    expect(result.acceptedMessage).toMatchObject({ message: "second" });
    expect(harness.calls.at(-1)).toMatchObject({
      input: { delivery: "steer", model },
    });
    expect(harness.queueTexts()).toEqual(["first:queued"]);
    expect(harness.pause()).not.toBeNull();
  });

  test("ends a pause when its last queued message reaches the agent", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    await harness.submit("first");
    harness.stop();

    await harness.manage({ kind: "steer", submissionId: "submission-first" });

    expect(harness.service.listQueues("/repo")).toEqual([]);
  });

  test("keeps a message that failed to steer and pauses delivery", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    await harness.submit("first");
    harness.outcomes.push(
      new HostOperationError({ operation: "test", message: "The turn ended." }),
    );

    const failure = await failureOf(
      harness.manage({ kind: "steer", submissionId: "submission-first" }),
    );

    expect(failure).toMatchObject({ message: "The turn ended." });
    expect(harness.service.listQueues("/repo")[0]?.entries[0]).toMatchObject({
      state: "queued",
      error: "The turn ended.",
    });
    expect(harness.pause()).toContain("The turn ended.");
  });

  test("steers a composed message at once without touching the queue", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    await harness.submit("first");

    harness.upsertSession({ activity: "running" });
    const result = await harness.submit("now", "steer");

    expect(result).toMatchObject({ kind: "accepted", acceptedMessage: { message: "now" } });
    expect(harness.sentTexts()).toEqual(["first:new_turn", "now:steer"]);
    expect(harness.queueTexts()).toEqual(["first:queued"]);
  });

  test("refuses steering that the runtime version or message cannot support while work runs", async () => {
    const harness = createHarness({
      available: false,
      reason: "Update Codex to 0.106.0 or later.",
    });
    harness.outcomes.push("busy");

    harness.upsertSession({ activity: "running" });
    const failure = await failureOf(harness.submit("now", "steer"));

    expect(failure).toMatchObject({ message: "Update Codex to 0.106.0 or later." });
    expect(harness.sentTexts()).toEqual([]);
    expect(harness.service.listQueues("/repo")).toEqual([]);

    const slashHarness = createHarness();
    slashHarness.outcomes.push("busy");
    slashHarness.upsertSession({ activity: "running" });
    const slashFailure = await failureOf(
      slashHarness.submitParts("submission-slash", [slashCommand], "steer"),
    );
    expect(slashFailure).toMatchObject({ field: "parts" });
  });

  test("sends an explicit message to an idle session as a new turn when it cannot steer", async () => {
    const harness = createHarness();

    const result = await harness.submitParts("submission-compact", [slashCommand], "steer");

    expect(result.kind).toBe("accepted");
    expect(harness.calls).toEqual([{ input: expect.objectContaining({ delivery: "new_turn" }) }]);
  });

  test("returns a queued command to the queue without a pause when it cannot join running work", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    await harness.submitParts("submission-command", [slashCommand]);
    harness.outcomes.push("busy");

    harness.upsertSession({ activity: "running" });
    const failure = await failureOf(
      harness.manage({ kind: "steer", submissionId: "submission-command" }),
    );

    expect(failure).toMatchObject({ field: "parts" });
    expect(harness.service.listQueues("/repo")[0]).toMatchObject({
      entries: [{ submissionId: "submission-command", state: "queued" }],
      pause: null,
    });
  });

  test("pauses the queue when a steer from the composer fails", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    await harness.submit("first");
    harness.outcomes.push(new HostOperationError({ operation: "test", message: "Turn ended." }));

    harness.upsertSession({ activity: "running" });
    const failure = await failureOf(harness.submit("now", "steer"));
    harness.idle();
    await harness.runBackground();

    expect(failure).toMatchObject({ message: "Turn ended." });
    expect(harness.pause()).toBe(
      "Steering failed: Turn ended. Resume the queue to send the next message.",
    );
    expect(harness.queueTexts()).toEqual(["first:queued"]);
    expect(harness.sentTexts()).toEqual(["first:new_turn", "now:steer"]);
  });

  test("pauses the queue with a notice when a composer steer reached the agent before a later failure", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    await harness.submit("first");
    harness.outcomes.push(acceptedThenFailed("now", "steer"));

    harness.upsertSession({ activity: "running" });
    await failureOf(harness.submit("now", "steer"));

    expect(harness.pause()).toContain("The agent received the message, but a later update failed");
    expect(harness.sentTexts()).toEqual(["first:new_turn", "now:steer"]);
  });

  test("retains a refused idle new turn until an explicit queue Resume", async () => {
    const harness = createHarness({
      available: false,
      reason: "Update Codex to 0.106.0 or later.",
    });
    harness.outcomes.push("busy", "busy");
    await harness.submit("first");
    harness.setOnSend(() => {
      harness.setOnSend(() => {});
      // The turn completes while the entry still steers, so this drain finds nothing to send.
      harness.idle();
      void harness.runBackground();
    });

    const failure = await failureOf(
      harness.manage({ kind: "steer", submissionId: "submission-first" }),
    );
    await harness.runBackground();

    expect(failure).not.toBeNull();
    expect(harness.sentTexts()).toEqual(["first:new_turn", "first:new_turn"]);
    expect(harness.queueTexts()).toEqual(["first:queued"]);
    await harness.manage({ kind: "resume" });
    await harness.runBackground();
    expect(harness.sentTexts()).toEqual(["first:new_turn", "first:new_turn", "first:new_turn"]);
    expect(harness.queueTexts()).toEqual([]);
  });
});

describe("agent message delivery: unknown acceptance", () => {
  test("keeps a message with an unknown result, blocks every action on it, and clears it when the agent shows it", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy", "unknown");
    await harness.submit("first");
    await harness.submit("second");

    harness.idle();
    await harness.runBackground();

    expect(harness.queueTexts()).toEqual(["first:acceptance_unknown", "second:queued"]);
    for (const action of [
      { kind: "steer", submissionId: "submission-first" },
      { kind: "remove", submissionId: "submission-first" },
      { kind: "begin_edit", submissionId: "submission-first" },
    ] as const) {
      const failure = await failureOf(harness.manage(action));
      expect(failure?.message).toContain("cannot tell if the agent received this message");
    }
    expect(harness.pause()).toContain("cannot tell if the agent received a message");
    const resumeFailure = await failureOf(harness.manage({ kind: "resume" }));
    expect(resumeFailure?.message).toContain("cannot tell if the agent received a message");
    harness.idle();
    await harness.runBackground();
    expect(harness.sentTexts()).toEqual(["first:new_turn", "first:new_turn"]);

    harness.userMessage("message-first");
    harness.idle();
    await harness.runBackground();

    // The remaining message waits for Resume after the unknown result resolves.
    expect(harness.queueTexts()).toEqual(["second:queued"]);
    expect(harness.pause()).toContain("Resume the queue to send the next message");
    await harness.manage({ kind: "resume" });
    await harness.runBackground();
    expect(harness.sentTexts()).toEqual(["first:new_turn", "first:new_turn", "second:new_turn"]);
    expect(harness.calls).toHaveLength(3);
  });

  test("keeps an immediate send with an unknown result in the queue, where nobody can remove it", async () => {
    const harness = createHarness();
    harness.outcomes.push("unknown");

    const result = await harness.submit("first");

    expect(result).toMatchObject({
      kind: "queued",
      queue: { entries: [{ submissionId: "submission-first", state: "acceptance_unknown" }] },
    });
    expect(
      await failureOf(harness.manage({ kind: "remove", submissionId: "submission-first" })),
    ).toBeInstanceOf(Error);
    expect(await harness.submit("first")).toMatchObject({
      kind: "acknowledged",
      outcome: "uncertain",
      submissionId: "submission-first",
    });
    expect(harness.calls).toHaveLength(1);
  });

  test("keeps the queue of a composer steer that is in flight, so an unknown result stays visible", async () => {
    const harness = createHarness();
    harness.outcomes.push("accept", "unknown");
    let other: Promise<unknown> | null = null;
    harness.setOnSend(() => {
      harness.setOnSend(() => {});
      // A default send to the same session ends while the steer still waits for its answer.
      other = harness.submit("other");
    });

    const steered = await harness.submit("now", "steer");

    expect(await other).toMatchObject({ kind: "accepted" });
    expect(steered).toMatchObject({ kind: "queued" });
    expect(harness.queueTexts()).toEqual(["now:acceptance_unknown"]);
    const resumeFailure = await failureOf(harness.manage({ kind: "resume" }));
    expect(resumeFailure?.message).toContain("cannot tell if the agent received a message");
  });

  test("keeps the unknown-delivery pause when another message reaches the agent", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy", "unknown");
    await harness.submit("first");
    await harness.submit("second");
    harness.idle();
    await harness.runBackground();
    harness.setOnSend(() => {
      harness.setOnSend(() => {});
      harness.userMessage("message-second", "submission-second");
    });

    await harness.manage({ kind: "steer", submissionId: "submission-second" });

    expect(harness.queueTexts()).toEqual(["first:acceptance_unknown"]);
    expect(harness.pause()).toContain("cannot tell if the agent received a message");
  });

  test.each([
    {
      state: "sending",
      delivery: "new_turn",
      deliver: (harness: DeliveryHarness) => {
        harness.idle();
        return harness.runBackground();
      },
    },
    {
      state: "steering",
      delivery: "steer",
      deliver: (harness: DeliveryHarness) =>
        harness.manage({ kind: "steer", submissionId: "submission-first" }),
    },
  ])(
    "removes a $state entry when its accepted message enters the transcript first",
    async ({ delivery, deliver }) => {
      const harness = createHarness();
      harness.outcomes.push("busy");
      await harness.submit("first");
      if (delivery === "steer") harness.upsertSession({ activity: "running" });
      const entriesAtAcceptance: string[][] = [];
      harness.setOnSend(() => {
        harness.setOnSend(() => {});
        // The adapter publishes the accepted message before the send returns.
        harness.userMessage("message-first", "submission-first");
        entriesAtAcceptance.push(harness.queueTexts());
      });

      await deliver(harness);

      expect(entriesAtAcceptance).toEqual([[]]);
      expect(harness.calls).toHaveLength(2);
      expect(harness.calls.at(-1)?.input).toMatchObject({
        delivery,
        submissionId: "submission-first",
      });
      expect(harness.service.listQueues("/repo")).toEqual([]);
    },
  );

  test("keeps a newer queue of the session when a steered entry ended its queue", async () => {
    const harness = createHarness();
    harness.outcomes.push("busy");
    await harness.submit("first");
    harness.setOnSend(() => {
      harness.setOnSend(() => {});
      // The transcript shows the steered entry, so its queue ends. A new message then queues.
      harness.userMessage("message-first", "submission-first");
      harness.outcomes.push("busy");
      void harness.submit("second");
    });

    const result = await harness.manage({ kind: "steer", submissionId: "submission-first" });

    expect(result.acceptedMessage).toMatchObject({ message: "first" });
    expect(harness.queueTexts()).toEqual(["second:queued"]);
    expect(harness.envelopes.at(-1)).toMatchObject({
      type: "message_queue_updated",
      queue: { entries: [{ submissionId: "submission-second" }] },
    });
  });
});

import { describe, expect, test } from "bun:test";
import {
  codexSessionRuntimeRef,
  codexStartSessionInput,
  codexUserMessageInput,
  createHarness,
  createRuntimeStreamSubscription,
  flushCodexAdapterWork,
} from "./codex-app-server-adapter.test-harness";

describe("Codex safety buffering", () => {
  test("emits status changes only for the active turn", async () => {
    const { subscribeEvents, emitNotification } = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({ subscribeEvents }, { deferTurnStart: true });
    const emitSafetyBuffering = (turnId: string, showBufferingUi: boolean): void => {
      emitNotification({
        method: "model/safetyBuffering/updated",
        params: {
          threadId: "thread/start-runtime-live",
          turnId,
          model: "gpt-5",
          useCases: ["cyber"],
          reasons: ["policy-check"],
          showBufferingUi,
          fasterModel: null,
        },
      });
    };

    await adapter.startSession(codexStartSessionInput());
    const events: Array<{ type?: string; status?: unknown }> = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );
    await flushCodexAdapterWork();

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Start now" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );
    emitNotification({
      method: "turn/started",
      params: {
        threadId: "thread/start-runtime-live",
        turn: { id: "turn-live" },
      },
    });
    emitSafetyBuffering("turn-live", true);
    emitSafetyBuffering("turn-stale", true);
    emitSafetyBuffering("turn-live", false);
    await flushCodexAdapterWork();

    expect(events.filter((event) => event.type === "session_status")).toEqual([
      {
        type: "session_status",
        externalSessionId: "thread/start-runtime-live",
        timestamp: expect.any(String),
        status: {
          type: "busy",
          message: "Our systems are thinking a bit more about this request before responding.",
        },
        sessionRef: expect.any(Object),
      },
      {
        type: "session_status",
        externalSessionId: "thread/start-runtime-live",
        timestamp: expect.any(String),
        status: { type: "busy", message: null },
        sessionRef: expect.any(Object),
      },
    ]);

    transports.get("runtime-live")?.turnStartDeferred.resolve({
      turn: { id: "turn-live", status: "running" },
    });
    unsubscribe();
  });
});

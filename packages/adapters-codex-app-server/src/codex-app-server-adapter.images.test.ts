import { expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import type { AgentImageGenerationPart } from "@openducktor/contracts";
import {
  codexSessionRuntimeRef,
  codexStartSessionInput,
  codexTurnFixture,
  createHarness,
  createRuntimeStreamSubscription,
  flushCodexAdapterWork,
} from "./codex-app-server-adapter.test-harness";

test("ordered live image events retain terminal output through replay and turn completion", async () => {
  const { subscribeEvents, emitNotification } = createRuntimeStreamSubscription();
  const mutations: AgentImageGenerationPart[] = [];
  const { adapter } = createHarness({
    subscribeEvents,
    onLiveSessionMutation: (mutation) => {
      for (const event of mutation.transcriptEvents)
        if (event.type === "assistant_part" && event.part.kind === "image_generation")
          mutations.push(event.part);
    },
  });
  await adapter.startSession(codexStartSessionInput());
  const ref = codexSessionRuntimeRef();
  const events: AgentEvent[] = [];
  const unsubscribe = await adapter.subscribeEvents(ref, (event) => events.push(event));
  const image = {
    type: "imageGeneration",
    id: "image",
    status: "in_progress",
    result: "",
    revisedPrompt: null,
    transparentBackground: null,
    failure: null,
  };
  const started = {
    method: "item/started",
    params: { threadId: ref.externalSessionId, turnId: "turn", startedAtMs: 0, item: image },
  };
  try {
    emitNotification(started);
    emitNotification({
      method: "item/completed",
      params: {
        ...started.params,
        completedAtMs: 1,
        item: { ...image, status: "completed", result: "private-bytes" },
      },
    });
    emitNotification(started);
    emitNotification({
      method: "turn/completed",
      params: {
        threadId: ref.externalSessionId,
        turn: codexTurnFixture({ id: "turn", items: [], status: "completed" }),
      },
    });
    await flushCodexAdapterWork();
    expect(events.filter((event) => event.type === "session_error")).toEqual([]);
    expect(mutations.map((part) => part.status)).toEqual(["running", "completed", "completed"]);
    expect(mutations.every((part) => part.turnId === "turn")).toBe(true);
    expect(JSON.stringify(events)).not.toContain("private-bytes");
  } finally {
    unsubscribe();
    adapter.releaseRuntime("runtime-live");
  }
});

for (const outcome of ["interrupted", "failed", "completed", "stop"] as const) {
  test(`unfinished image settles on ${outcome}`, async () => {
    const { subscribeEvents, emitNotification } = createRuntimeStreamSubscription();
    const { adapter } = createHarness({ subscribeEvents });
    await adapter.startSession(codexStartSessionInput());
    const ref = codexSessionRuntimeRef();
    const parts: AgentImageGenerationPart[] = [];
    const unsubscribe = await adapter.subscribeEvents(ref, (event) => {
      if (event.type === "assistant_part" && event.part.kind === "image_generation")
        parts.push(event.part);
    });
    try {
      emitNotification({
        method: "item/started",
        params: {
          threadId: ref.externalSessionId,
          turnId: "turn",
          startedAtMs: 0,
          item: {
            type: "imageGeneration",
            id: "image",
            status: "in_progress",
            result: "",
            revisedPrompt: null,
            transparentBackground: null,
            failure: null,
          },
        },
      });
      await flushCodexAdapterWork();
      if (outcome === "stop") {
        const settled = adapter.settleGeneratedImages("runtime-live", ref);
        expect(settled).toHaveLength(1);
        expect(settled[0]).toMatchObject({
          type: "assistant_part",
          sessionRef: {
            repoPath: ref.repoPath,
            runtimeKind: ref.runtimeKind,
            workingDirectory: ref.workingDirectory,
            externalSessionId: ref.externalSessionId,
          },
          part: { status: "incomplete" },
        });
        expect(adapter.settleGeneratedImages("runtime-live", ref)).toEqual([]);
        await adapter.stopSession(ref);
      } else
        emitNotification({
          method: "turn/completed",
          params: {
            threadId: ref.externalSessionId,
            turn: codexTurnFixture({ id: "turn", items: [], status: outcome }),
          },
        });
      await flushCodexAdapterWork();
      expect(parts.at(-1)?.status).toBe(outcome === "interrupted" ? "interrupted" : "incomplete");
    } finally {
      unsubscribe();
      adapter.releaseRuntime("runtime-live");
    }
  });
}

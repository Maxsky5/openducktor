import { expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import {
  codexSessionRuntimeRef,
  codexStartSessionInput,
  codexTurnFixture,
  createDeferred,
  createHarness,
  createRuntimeStreamSubscription,
  flushCodexAdapterWork,
} from "./codex-app-server-adapter.test-harness";

const createRoutedImages = async () => {
  const stream = createRuntimeStreamSubscription();
  const events: AgentEvent[] = [];
  const { adapter, transports } = createHarness({
    subscribeEvents: stream.subscribeEvents,
    onLiveSessionMutation: (mutation) => events.push(...mutation.transcriptEvents),
  });
  const ref = codexSessionRuntimeRef();
  const start = async () => {
    await adapter.startSession(codexStartSessionInput());
    const routes: [string, string][] = [
      [ref.externalSessionId, "child"],
      ["child", "nested"],
    ];
    for (const [parent, child] of routes) {
      stream.emitNotification({
        method: "item/completed",
        params: {
          threadId: parent,
          turnId: "spawn-turn",
          completedAtMs: 1,
          item: {
            type: "collabAgentToolCall",
            id: `spawn-${child}`,
            tool: "spawnAgent",
            status: "completed",
            senderThreadId: parent,
            receiverThreadIds: [child],
            prompt: "Generate image",
            model: null,
            reasoningEffort: null,
            agentsStates: { [child]: { status: "running", message: null } },
          },
        },
      });
      await flushCodexAdapterWork();
      for (const status of ["in_progress", "completed", "failed"]) {
        stream.emitNotification({
          method: status === "in_progress" ? "item/started" : "item/completed",
          params: {
            threadId: child,
            turnId: "image-turn",
            startedAtMs: 0,
            completedAtMs: 1,
            item: {
              type: "imageGeneration",
              id: status,
              status,
              result: status === "completed" ? "private-bytes" : "",
              revisedPrompt: null,
              transparentBackground: null,
              failure: null,
            },
          },
        });
      }
      await flushCodexAdapterWork();
    }
  };
  await start();
  return { adapter, events, ref, start, transports };
};

for (const scope of ["session", "runtime"] as const) {
  test(`${scope} image settlement includes routed children and nested children`, async () => {
    const { adapter, events: liveEvents, ref } = await createRoutedImages();
    try {
      expect(liveEvents.filter((event) => event.type === "session_error")).toEqual([]);
      expect(adapter.settleGeneratedImages("other-runtime", ref)).toEqual([]);
      expect(adapter.settleGeneratedImages("runtime-live", { ...ref, repoPath: "/other" })).toEqual(
        [],
      );
      expect(
        adapter.settleGeneratedImages("runtime-live", { ...ref, workingDirectory: "/other" }),
      ).toEqual([]);
      const events = adapter.settleGeneratedImages(
        "runtime-live",
        scope === "session" ? ref : undefined,
      );
      expect(
        events
          .filter((event) => event.type === "image_generation_settled")
          .map((event) => event.externalSessionId),
      ).toEqual([ref.externalSessionId, "child", "nested"]);
      expect(events.filter((event) => event.type === "assistant_part")).toMatchObject(
        ["child", "nested"].map((externalSessionId) => ({
          type: "assistant_part",
          externalSessionId,
          sessionRef: {
            repoPath: ref.repoPath,
            workingDirectory: ref.workingDirectory,
            externalSessionId,
          },
          part: {
            itemId: "in_progress",
            status: "incomplete",
            incompleteReason: scope === "session" ? "turn_ended" : "runtime_failure",
          },
        })),
      );
      expect(JSON.stringify(events)).not.toContain("private-bytes");
      expect(
        adapter
          .settleGeneratedImages("runtime-live", ref)
          .filter((event) => event.type === "assistant_part"),
      ).toEqual([]);
    } finally {
      adapter.releaseRuntime("runtime-live");
    }
  });
}

test("child history pending at parent release cannot revive an unseen image", async () => {
  const { adapter, transports, ref } = await createRoutedImages();
  const transport = transports.get("runtime-live")!;
  const request = transport.request.bind(transport);
  const entered = createDeferred<void>();
  const resume = createDeferred<void>();
  transport.request = async (input) => {
    if (input.method !== "thread/turns/list" || input.params.threadId !== "nested")
      return request(input);
    entered.resolve();
    await resume.promise;
    return {
      data: [
        codexTurnFixture({
          id: "unseen-turn",
          status: "inProgress",
          items: [
            {
              type: "imageGeneration",
              id: "unseen",
              status: "in_progress",
              result: "",
              revisedPrompt: null,
              transparentBackground: null,
              failure: null,
            },
          ],
        }),
      ],
      nextCursor: null,
      backwardsCursor: null,
    };
  };
  const history = adapter.loadSessionHistory({ ...ref, externalSessionId: "nested" });
  try {
    await entered.promise;
    await adapter.stopSession(ref);
    resume.resolve();
    expect(
      (await history)
        .flatMap((message) => message.parts)
        .filter((part) => part.kind === "image_generation"),
    ).toMatchObject([{ status: "incomplete" }]);
  } finally {
    resume.resolve();
    await history;
    adapter.releaseRuntime("runtime-live");
  }
});

for (const cleanup of ["stop", "release", "runtime"] as const) {
  test(`${cleanup} clears routed image state before the same child route is reused`, async () => {
    const { adapter, events, ref, start } = await createRoutedImages();
    try {
      if (cleanup === "stop") await adapter.stopSession(ref);
      else if (cleanup === "release") await adapter.releaseSession(ref);
      else adapter.releaseRuntime("runtime-live");
      events.length = 0;
      await start();
      expect(events.filter((event) => event.type === "session_error")).toEqual([]);
      expect(
        events.filter(
          (event) =>
            event.type === "assistant_part" &&
            event.part.kind === "image_generation" &&
            event.part.itemId === "in_progress",
        ),
      ).toMatchObject(
        ["child", "nested"].map((externalSessionId) => ({
          externalSessionId,
          part: { status: "running" },
        })),
      );
    } finally {
      adapter.releaseRuntime("runtime-live");
    }
  });
}

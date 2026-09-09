import { expect, test } from "bun:test";
import type { AgentImageGenerationPart } from "@openducktor/contracts";
import {
  codexSessionRuntimeRef,
  codexStartSessionInput,
  codexThreadFixture,
  codexTurnFixture,
  createDeferred,
  createHarness,
  createRuntimeStreamSubscription,
  flushCodexAdapterWork,
  RecordingTransport,
} from "./codex-app-server-adapter.test-harness";

for (const order of ["history-first", "terminal-first", "during-history"] as const) {
  test(`public history participates in interrupted-turn settlement: ${order}`, async () => {
    const { subscribeEvents, emitNotification } = createRuntimeStreamSubscription();
    const historyRead = createDeferred<void>();
    const releaseHistory = createDeferred<void>();
    const projected: AgentImageGenerationPart[] = [];
    const settledTurns: string[] = [];
    const ref = codexSessionRuntimeRef();
    const { adapter } = createHarness({
      subscribeEvents,
      onLiveSessionMutation: (mutation) => {
        for (const event of mutation.transcriptEvents) {
          if (event.type === "image_generation_settled" && event.turnId)
            settledTurns.push(event.turnId);
          if (event.type === "assistant_part" && event.part.kind === "image_generation")
            projected.push(event.part);
        }
      },
      transportFactory: (runtimeId) => {
        const transport = new RecordingTransport(runtimeId, false);
        return {
          request: async (request) => {
            if (request.method === "thread/read")
              return {
                thread: codexThreadFixture({
                  id: ref.externalSessionId,
                  cwd: ref.workingDirectory,
                  status: { type: "active", activeFlags: [] },
                }),
              };
            if (request.method === "thread/turns/list") {
              historyRead.resolve();
              if (order === "during-history") await releaseHistory.promise;
              return {
                data: [
                  codexTurnFixture({
                    id: "image-turn",
                    status: "inProgress",
                    items: [
                      {
                        type: "imageGeneration",
                        id: "image",
                        status: "in_progress",
                        revisedPrompt: null,
                        transparentBackground: null,
                        failure: null,
                        result: "",
                      },
                    ],
                  }),
                ],
                nextCursor: null,
                backwardsCursor: null,
              };
            }
            return transport.request(request);
          },
        };
      },
    });
    await adapter.startSession(codexStartSessionInput());
    const terminate = async () => {
      emitNotification({
        method: "turn/completed",
        params: {
          threadId: ref.externalSessionId,
          turn: codexTurnFixture({ id: "image-turn", status: "interrupted", items: [] }),
        },
      });
      await flushCodexAdapterWork();
    };
    try {
      if (order === "terminal-first") await terminate();
      const pending = adapter.loadSessionHistory(ref);
      if (order === "during-history") {
        await historyRead.promise;
        await terminate();
        releaseHistory.resolve();
      }
      const history = await pending;
      const image = history
        .flatMap((message) => message.parts ?? [])
        .find((part) => part.kind === "image_generation");
      expect(image).toMatchObject({
        status: order === "history-first" ? "running" : "interrupted",
      });
      if (order === "history-first") {
        await terminate();
        expect(projected.at(-1)?.status).toBe("interrupted");
      }
      expect(settledTurns).toContain("image-turn");
      expect(adapter.listLiveSessionSnapshots("runtime-live")[0]?.pendingQuestions).toEqual([]);
    } finally {
      releaseHistory.resolve();
      adapter.releaseRuntime("runtime-live");
    }
  });
}

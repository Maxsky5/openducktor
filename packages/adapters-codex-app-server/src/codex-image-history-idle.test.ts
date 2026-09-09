import { expect, test } from "bun:test";
import type { AgentSessionTranscriptEvent } from "@openducktor/contracts";
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

const imageTurn = (id: string) =>
  codexTurnFixture({
    id,
    status: "inProgress",
    startedAt: null,
    completedAt: null,
    items: [
      {
        type: "imageGeneration",
        id: `image-${id}`,
        status: "in_progress",
        revisedPrompt: null,
        transparentBackground: null,
        failure: null,
        result: "",
      },
    ],
  });

test("idle without a local turn settles pending nullable-timestamp history and permits a new real turn", async () => {
  const { subscribeEvents, emitNotification } = createRuntimeStreamSubscription();
  const historyRead = createDeferred<void>();
  const releaseHistory = createDeferred<void>();
  const ref = codexSessionRuntimeRef();
  const events: AgentSessionTranscriptEvent[] = [];
  let turns = [imageTurn("old-turn")];
  const { adapter } = createHarness({
    subscribeEvents,
    onLiveSessionMutation: (mutation) => {
      events.push(...mutation.transcriptEvents);
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
            await releaseHistory.promise;
            return { data: turns, nextCursor: null, backwardsCursor: null };
          }
          return transport.request(request);
        },
      };
    },
  });
  await adapter.startSession(codexStartSessionInput());
  try {
    const pending = adapter.loadSessionHistory(ref);
    await historyRead.promise;
    emitNotification({
      method: "thread/status/changed",
      params: { threadId: ref.externalSessionId, status: { type: "idle" } },
    });
    await flushCodexAdapterWork();
    const terminal = events.find((event) => event.type === "image_generation_settled");
    expect(terminal).toMatchObject({ reason: "turn_ended" });
    expect(terminal && "turnId" in terminal).toBe(false);
    const liveBeforeHistory = adapter.listLiveSessionSnapshots("runtime-live");
    releaseHistory.resolve();
    const history = await pending;
    const image = history.find((message) =>
      message.parts.some((part) => part.kind === "image_generation"),
    );
    expect(image?.timestampIsApproximate).toBe(true);
    expect(image?.parts[0]).toMatchObject({ status: "incomplete", incompleteReason: "turn_ended" });
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual(liveBeforeHistory);

    turns = [...turns, imageTurn("new-turn")];
    emitNotification({
      method: "turn/started",
      params: { threadId: ref.externalSessionId, turn: imageTurn("new-turn") },
    });
    await flushCodexAdapterWork();
    const reloaded = await adapter.loadSessionHistory(ref);
    expect(reloaded.flatMap((message) => message.parts)).toMatchObject([
      { itemId: "image-old-turn", status: "incomplete" },
      { itemId: "image-new-turn", status: "running" },
    ]);
  } finally {
    releaseHistory.resolve();
    adapter.releaseRuntime("runtime-live");
  }
});

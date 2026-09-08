import { expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import {
  codexImageGenerationPart,
  type CodexImageGenerationPreparation,
} from "./codex-image-generation";
import {
  codexSessionRuntimeRef,
  codexStartSessionInput,
  codexTurnFixture,
  createHarness,
  createRuntimeStreamSubscription,
  flushCodexAdapterWork,
} from "./codex-app-server-adapter.test-harness";

const imageNotification = (result = "private-image") => ({
  method: "item/completed" as const,
  params: {
    threadId: codexSessionRuntimeRef().externalSessionId,
    turnId: "turn",
    completedAtMs: 1,
    item: {
      type: "imageGeneration" as const,
      id: "image",
      status: "completed",
      result,
      revisedPrompt: null,
      failure: null,
    },
  },
});

test("large live images use asynchronous preparation before queued turn settlement", async () => {
  const started = Promise.withResolvers<readonly CodexImageGenerationPreparation[]>();
  const finish = Promise.withResolvers<void>();
  const { subscribeEvents, emitNotification } = createRuntimeStreamSubscription();
  const events: AgentEvent[] = [];
  const { adapter } = createHarness({
    subscribeEvents,
    prepareImageGenerations: async (images) => {
      started.resolve(images);
      await finish.promise;
      return images.map(({ item, context }) =>
        codexImageGenerationPart(item, context, "worker-revision"),
      );
    },
  });
  await adapter.startSession(codexStartSessionInput());
  const unsubscribe = await adapter.subscribeEvents(codexSessionRuntimeRef(), (event) =>
    events.push(event),
  );
  try {
    const notification = imageNotification("A".repeat(Math.ceil((32 * 1024 * 1024) / 3) * 4));
    emitNotification(notification);
    emitNotification({
      method: "turn/completed",
      params: {
        threadId: notification.params.threadId,
        turn: codexTurnFixture({ id: "turn", status: "completed", items: [] }),
      },
    });
    const images = await started.promise;
    expect(images[0]?.item.result).toBe(notification.params.item.result);
    expect(images[0]?.context).toEqual({ turnId: "turn", liveStart: false });
    expect(
      events.filter(
        (event) => event.type === "assistant_part" || event.type === "image_generation_settled",
      ),
    ).toEqual([]);
    finish.resolve();
    await flushCodexAdapterWork();
    expect(
      events.filter(
        (event) => event.type === "assistant_part" || event.type === "image_generation_settled",
      ),
    ).toMatchObject([
      {
        type: "assistant_part",
        part: { status: "completed", output: { revision: "worker-revision" } },
      },
      { type: "image_generation_settled", turnId: "turn" },
    ]);
    expect(events.filter((event) => event.type === "session_error")).toEqual([]);
  } finally {
    finish.resolve();
    unsubscribe();
    adapter.releaseRuntime("runtime-live");
  }
});

for (const release of ["session", "runtime"] as const) {
  test(`${release} release cancels live preparation and rejects its late result`, async () => {
    const started = Promise.withResolvers<AbortSignal>();
    const finish = Promise.withResolvers<void>();
    const { subscribeEvents, emitNotification } = createRuntimeStreamSubscription();
    const events: AgentEvent[] = [];
    const { adapter } = createHarness({
      subscribeEvents,
      prepareImageGenerations: async (images, signal) => {
        if (!signal) throw new Error("Missing preparation signal");
        started.resolve(signal);
        await finish.promise;
        return images.map(({ item, context }) =>
          codexImageGenerationPart(item, context, "late-revision"),
        );
      },
    });
    await adapter.startSession(codexStartSessionInput());
    const unsubscribe = await adapter.subscribeEvents(codexSessionRuntimeRef(), (event) =>
      events.push(event),
    );
    try {
      emitNotification(imageNotification());
      const signal = await started.promise;
      if (release === "runtime") adapter.releaseRuntime("runtime-live");
      else await adapter.releaseSession(codexSessionRuntimeRef());
      expect(signal.aborted).toBe(true);
      finish.resolve();
      await flushCodexAdapterWork();
      expect(
        events.filter((event) => event.type === "assistant_part" || event.type === "session_error"),
      ).toEqual([]);
    } finally {
      finish.resolve();
      unsubscribe();
      adapter.releaseRuntime("runtime-live");
    }
  });
}

for (const failure of ["worker", "identity"] as const) {
  test(`live image ${failure} failure is reported without synchronous preparation`, async () => {
    const { subscribeEvents, emitNotification } = createRuntimeStreamSubscription();
    const events: AgentEvent[] = [];
    const { adapter } = createHarness({
      subscribeEvents,
      prepareImageGenerations: async () => {
        if (failure === "worker") throw new Error("Image worker failed");
        return [];
      },
    });
    await adapter.startSession(codexStartSessionInput());
    const unsubscribe = await adapter.subscribeEvents(codexSessionRuntimeRef(), (event) =>
      events.push(event),
    );
    try {
      emitNotification(imageNotification());
      await flushCodexAdapterWork();
      expect(events.filter((event) => event.type === "assistant_part")).toEqual([]);
      expect(events.filter((event) => event.type === "session_error")).toMatchObject([
        {
          message: expect.stringContaining(
            failure === "worker" ? "Image worker failed" : "wrong item",
          ),
        },
      ]);
    } finally {
      unsubscribe();
      adapter.releaseRuntime("runtime-live");
    }
  });
}

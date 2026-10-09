import { expect, test } from "bun:test";
import { MANUAL_SESSION_COMPACTION_SLASH_COMMAND } from "@openducktor/contracts";
import { speedEligibility, initialSpeedState } from "@openducktor/core";
import { CodexMessageRejectedError } from "./codex-message-rejected-error";
import {
  RecordingTransport,
  codexSessionRuntimeRef,
  codexStartSessionInput,
  codexUserMessageInput,
  createAdapterWithTransport,
  createRuntimeStreamSubscription,
  flushCodexAdapterWork,
} from "./codex-app-server-adapter.test-harness";
import type { CodexJsonRpcRequest } from "./index";
import type { CodexLiveSessionMutation, CodexModelListResponse } from "./types";
import type { AgentModelSelection } from "@openducktor/core";
import { FastTransport, settingsReport } from "./codex-app-server-adapter.speed.test-harness";

const harness = (publish: () => Promise<void> = async () => {}) => {
  const transport = new FastTransport("runtime-live", false);
  const stream = createRuntimeStreamSubscription();
  const saved: Array<string | null> = [];
  const failures: unknown[] = [];
  const mutations: CodexLiveSessionMutation[] = [];
  const adapter = createAdapterWithTransport(transport, {
    subscribeEvents: stream.subscribeEvents,
    onRuntimeEventQueueFailure: ({ error }) => {
      failures.push(error);
    },
    onLiveSessionMutation: (mutation) => {
      mutations.push(mutation);
      if (mutation.fault) failures.push(mutation.fault);
    },
    recordSpeedChoice: async (_ref, choice) => {
      saved.push(choice);
      return publish;
    },
  });
  const report = (serviceTier: string | null, threadId = "thread/start-runtime-live") =>
    stream.emitNotification(settingsReport(serviceTier, threadId));
  transport.onSettingsUpdate = (tier, threadId) => queueMicrotask(() => report(tier, threadId));
  return { adapter, transport, report, saved, stream, failures, mutations };
};

test.each(["context", "subscription"] as const)(
  "%s recovery confirms known tiers and blocks an unknown tier",
  async (path) => {
    for (const [tier, choice] of [
      ["priority-example", "priority-example"],
      ["default", "standard"],
      ["ultrafast", "ultrafast"],
      ["future-speed", "future-speed"],
      ["unknown-tier", null],
    ] as const) {
      const { adapter, transport } = harness();
      transport.resumedTier = tier;
      const ref = codexSessionRuntimeRef("thread-saved");
      const unsubscribe =
        path === "subscription" ? await adapter.subscribeEvents(ref, () => {}) : undefined;
      try {
        if (path === "context") await adapter.loadSessionContextUsage(ref);
        expect(adapter.listLiveSessionSnapshots("runtime-live")[0]?.speed).toMatchObject({
          choice,
          synchronization: choice === null ? "unapplied" : "confirmed",
        });
        const message = codexUserMessageInput({
          externalSessionId: ref.externalSessionId,
          speed: choice,
          parts: [{ kind: "text", text: "Continue after recovery" }],
        });
        if (choice === null) {
          const error = await adapter.sendUserMessage(message).catch((cause: unknown) => cause);
          expect(error).toBeInstanceOf(CodexMessageRejectedError);
          expect(error).toMatchObject({
            message: "Set fast mode explicitly before sending another message.",
          });
          expect(transport.calls.filter((call) => call.method === "turn/start")).toEqual([]);
        } else {
          await adapter.sendUserMessage(message);
          expect(
            transport.calls.find((call) => call.method === "turn/start")?.params,
          ).toMatchObject({
            serviceTier: choice === "standard" ? null : choice,
          });
        }
        expect(transport.calls.filter((call) => call.method === "thread/settings/update")).toEqual(
          [],
        );
      } finally {
        unsubscribe?.();
      }
    }
  },
);

test.each(["resume", "repository resume", "cold control"] as const)(
  "%s sends explicit null after a native default tier report",
  async (path) => {
    const { adapter, transport } = harness();
    const ref = codexSessionRuntimeRef("thread-saved", { speed: "standard" });
    if (path === "repository resume") {
      ref.sessionScope = { kind: "repository" };
      delete ref.systemPrompt;
    }
    if (path === "cold control") {
      const release = await adapter.holdSessionTurns(ref, ref);
      await release();
    } else {
      await adapter.resumeSession(ref);
      if (path === "repository resume") await adapter.resumeSession(ref);
    }
    await adapter.sendUserMessage({
      ...ref,
      parts: [{ kind: "text", text: "Continue with fast mode off" }],
    });
    expect(transport.calls.find((call) => call.method === "turn/start")?.params).toMatchObject({
      serviceTier: null,
    });
  },
);

test.each(["priority-example", "ultrafast", "future-speed"])(
  "uses the advertised %s for session and turn requests",
  async (tier) => {
    const { adapter, transport } = harness();
    const summary = await adapter.startSession(codexStartSessionInput({ speed: tier }));
    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: summary.externalSessionId,
        speed: tier,
        parts: [{ kind: "text", text: "Build it" }],
      }),
    );
    expect(transport.calls.find((call) => call.method === "thread/start")?.params).toMatchObject({
      serviceTier: tier,
      model: "gpt-5",
    });
    expect(transport.calls.find((call) => call.method === "turn/start")?.params).toMatchObject({
      serviceTier: tier,
    });
    expect(summary.speed?.choice).toBe(tier);
  },
);

test("keeps ordinary off use available for a model without a Fast tier", async () => {
  const transport = new RecordingTransport("runtime-live", false);
  const adapter = createAdapterWithTransport(transport);
  await expect(
    adapter.startSession(codexStartSessionInput({ speed: "priority-example" })),
  ).rejects.toThrow("does not advertise the requested speed level");
  const summary = await adapter.startSession(codexStartSessionInput());
  expect(summary.speed?.choice).toBe("standard");
  await adapter.sendUserMessage(
    codexUserMessageInput({
      externalSessionId: summary.externalSessionId,
      parts: [{ kind: "text", text: "Build it" }],
    }),
  );
  expect(transport.calls.find((call) => call.method === "thread/start")?.params).toMatchObject({
    serviceTier: null,
  });
  expect(transport.calls.find((call) => call.method === "turn/start")?.params).toMatchObject({
    serviceTier: null,
  });
});

test("holds new turns through native acknowledgement and confirmation", async () => {
  const { adapter, transport, report } = harness();
  const summary = await adapter.startSession(codexStartSessionInput());
  const ref = {
    ...codexUserMessageInput({ externalSessionId: summary.externalSessionId, parts: [] }),
    speed: "priority-example",
  };
  const release = await adapter.holdSessionTurns(ref, ref);
  transport.onSettingsUpdate = () => {};
  let accepted = false;
  const change = adapter.updateSessionSpeed(ref).then(() => {
    accepted = true;
  });
  await flushCodexAdapterWork();
  expect(accepted).toBe(false);
  for (const [speed, parts] of [
    ["priority-example", [{ kind: "text", text: "Do not restore yet" }]],
    ["standard", [{ kind: "text", text: "Do not start yet" }]],
    ["standard", [{ kind: "slash_command", command: MANUAL_SESSION_COMPACTION_SLASH_COMMAND }]],
  ] as const) {
    const error = await adapter
      .sendUserMessage({ ...ref, speed, parts: [...parts] })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(CodexMessageRejectedError);
    expect(error).toMatchObject({ message: expect.stringContaining("pending") });
  }
  expect(transport.calls.filter((call) => call.method === "turn/start")).toHaveLength(0);
  expect(transport.calls.filter((call) => call.method === "thread/compact/start")).toHaveLength(0);
  report("priority-example");
  await change;
  adapter.setSessionSpeedState(ref, initialSpeedState("priority-example", "confirmed"));
  await release();
  await adapter.sendUserMessage({ ...ref, parts: [{ kind: "text", text: "Start now" }] });
  expect(transport.calls.filter((call) => call.method === "thread/settings/update")).toHaveLength(
    1,
  );
  expect(transport.calls.find((call) => call.method === "turn/start")?.params).toMatchObject({
    serviceTier: "priority-example",
  });
});

test("reports a failed settings RPC without another control path", async () => {
  const transport = new FastTransport("runtime-live", false);
  const calls: CodexJsonRpcRequest[] = [];
  const adapter = createAdapterWithTransport({
    request: async (request) => {
      calls.push(request);
      if (request.method === "thread/settings/update") throw new Error("Method not found");
      return transport.request(request);
    },
  });
  const summary = await adapter.startSession(codexStartSessionInput());
  const ref = {
    ...codexUserMessageInput({ externalSessionId: summary.externalSessionId, parts: [] }),
    speed: "priority-example",
  };
  const release = await adapter.holdSessionTurns(ref, ref);
  const before = calls.length;
  await expect(adapter.updateSessionSpeed(ref)).rejects.toThrow("Method not found");
  expect(calls.slice(before).map((call) => call.method)).toEqual(["thread/settings/update"]);
  await release();
});

test.each(["catalog", "settings", "save"] as const)(
  "a failed %s check leaves an unstarted turn idle and permits a later turn",
  async (failure) => {
    const transport = new FastTransport("runtime-live", false);
    const stream = createRuntimeStreamSubscription();
    let fail = false;
    const adapter = createAdapterWithTransport(
      {
        request: async (request) => {
          if (fail && failure === "settings" && request.method === "thread/settings/update") {
            fail = false;
            throw new Error("Settings unavailable");
          }
          const response = await transport.request(request);
          if (request.method !== "model/list") return response;
          // SAFETY: FastTransport returns the native catalog fixture for model/list.
          const catalog = response as CodexModelListResponse;
          return {
            ...catalog,
            data: [
              ...catalog.data,
              ...catalog.data.map((model) => ({
                ...model,
                id: "standard-model",
                model: "standard-model",
                serviceTiers: [],
              })),
            ],
          };
        },
      },
      {
        subscribeEvents: stream.subscribeEvents,
        recordSpeedChoice: async () => {
          if (fail && failure === "save") throw new Error("Store unavailable");
          return async () => {};
        },
      },
    );
    transport.onSettingsUpdate = (tier, threadId) =>
      queueMicrotask(() => stream.emitNotification(settingsReport(tier, threadId)));
    const summary = await adapter.startSession(
      codexStartSessionInput({ speed: "priority-example" }),
    );
    stream.emitNotification({
      method: "thread/status/changed",
      params: { threadId: summary.externalSessionId, status: { type: "idle" } },
    });
    await flushCodexAdapterWork();
    const before = adapter.listLiveSessionSnapshots("runtime-live")[0];
    expect(before?.activity).toBe("idle");
    fail = true;
    await expect(
      adapter.sendUserMessage(
        codexUserMessageInput({
          externalSessionId: summary.externalSessionId,
          speed: "priority-example",
          model: {
            providerId: "codex",
            modelId: failure === "catalog" ? "missing-model" : "standard-model",
          },
          parts: [{ kind: "text", text: "Do not start" }],
        }),
      ),
    ).rejects.toThrow(
      failure === "catalog"
        ? "was not found in model/list"
        : failure === "settings"
          ? "Settings unavailable"
          : "Store unavailable",
    );
    expect(adapter.listLiveSessionSnapshots("runtime-live")[0]?.activity).toBe(before?.activity);
    expect(transport.calls.filter((call) => call.method === "turn/start")).toHaveLength(0);
    fail = false;
    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: summary.externalSessionId,
        model: { providerId: "codex", modelId: "gpt-5" },
        parts: [{ kind: "text", text: "Start the next turn" }],
      }),
    );
    expect(transport.calls.filter((call) => call.method === "turn/start")).toHaveLength(1);
  },
);

test("cold speed controls read native settings before applying the requested choice", async () => {
  const { adapter, transport } = harness();
  const ref = {
    ...codexUserMessageInput({ externalSessionId: "thread-1", parts: [] }),
    speed: "priority-example",
  };
  const release = await adapter.holdSessionTurns(ref, ref);
  expect(
    transport.calls.find((call) => call.method === "thread/resume")?.params,
  ).not.toHaveProperty("serviceTier");
  await adapter.updateSessionSpeed(ref);
  adapter.setSessionSpeedState(ref, initialSpeedState("priority-example", "confirmed"));
  await release();
  await adapter.sendUserMessage({ ...ref, parts: [{ kind: "text", text: "Continue" }] });
  expect(transport.calls.find((call) => call.method === "turn/start")?.params.serviceTier).toBe(
    "priority-example",
  );
});

test("rejects a launch whose native service tier differs from the requested choice", async () => {
  const transport = new RecordingTransport("runtime-live", false);
  const fast = new FastTransport("runtime-live", false);
  const adapter = createAdapterWithTransport({
    request: (request) =>
      request.method === "model/list" ? fast.request(request) : transport.request(request),
  });
  await expect(
    adapter.startSession(codexStartSessionInput({ speed: "priority-example" })),
  ).rejects.toThrow("did not accept");
  expect(transport.calls.filter((call) => call.method === "turn/start")).toHaveLength(0);
});

test("a native explicit off report saves off before the next turn", async () => {
  const { adapter, transport, report, saved } = harness();
  const summary = await adapter.startSession(
    codexStartSessionInput({
      speed: "priority-example",
      model: { providerId: "codex", modelId: "gpt-5", variant: "medium" },
    }),
  );
  report("default");
  await flushCodexAdapterWork();
  expect(saved).toEqual(["standard"]);
  const snapshot = adapter.listLiveSessionSnapshots("runtime-live")[0];
  if (!snapshot) throw new Error("Expected the session's live snapshot.");
  const catalog = await adapter.loadRuntimeCatalog({
    repoPath: "/repo",
    runtimeKind: "codex",
    workingDirectory: "/repo",
  });
  if (catalog.models?.status !== "available") throw new Error("Expected the native model catalog.");
  expect(speedEligibility(catalog.runtime, catalog.models.catalog, snapshot.model)).toBe(
    "supported",
  );
  await adapter.sendUserMessage(
    codexUserMessageInput({
      externalSessionId: summary.externalSessionId,
      speed: "standard",
      parts: [{ kind: "text", text: "Next turn" }],
    }),
  );
  expect(
    transport.calls.find((call) => call.method === "turn/start")?.params.serviceTier,
  ).toBeNull();
});

test("an unknown tier saves the reported model before a later speed choice", async () => {
  const transport = new FastTransport("runtime-live", false);
  transport.extraModels = ["gpt-5.1"];
  const stream = createRuntimeStreamSubscription();
  let savedModel: AgentModelSelection = {
    providerId: "codex",
    modelId: "gpt-5",
    variant: "medium",
  };
  let savedSpeed: string | null = "standard";
  const adapter = createAdapterWithTransport(transport, {
    subscribeEvents: stream.subscribeEvents,
    recordSpeedChoice: async (_ref, choice, _isCurrent, model) => {
      savedSpeed = choice;
      if (model) savedModel = model;
      return async () => {};
    },
  });
  const summary = await adapter.startSession(codexStartSessionInput({ model: savedModel }));
  const report = (tier: string) => {
    const notification = settingsReport(tier, summary.externalSessionId, "gpt-5.1", "high");
    notification.params.threadSettings.collaborationMode.settings.reasoning_effort = null;
    stream.emitNotification(notification);
  };
  report("unknown-tier");
  await flushCodexAdapterWork();
  expect(savedModel).toMatchObject({ modelId: "gpt-5.1", variant: "high" });
  expect(savedSpeed).toBeNull();
  expect(adapter.listLiveSessionSnapshots("runtime-live")[0]?.speed).toMatchObject({
    choice: null,
    synchronization: "uncertain",
  });
  await expect(
    adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: summary.externalSessionId,
        model: savedModel,
        speed: savedSpeed,
        parts: [{ kind: "text", text: "Do not start" }],
      }),
    ),
  ).rejects.toThrow("Set fast mode explicitly before sending another message.");
  expect(transport.calls.filter((call) => call.method === "turn/start")).toHaveLength(0);
  report("default");
  await flushCodexAdapterWork();
  await adapter.sendUserMessage(
    codexUserMessageInput({
      externalSessionId: summary.externalSessionId,
      model: savedModel,
      speed: savedSpeed,
      parts: [{ kind: "text", text: "Continue on the reported model" }],
    }),
  );
  expect(transport.calls.find((call) => call.method === "turn/start")?.params).toMatchObject({
    model: "gpt-5.1",
    effort: "high",
    serviceTier: null,
  });
});

test("a released runtime report cannot confirm a replacement runtime setting", async () => {
  const { adapter, transport, stream, report } = harness();
  await adapter.startSession(codexStartSessionInput());
  const old = stream.captureLatestSubscription();
  adapter.releaseRuntime("runtime-live");
  const summary = await adapter.startSession(codexStartSessionInput());
  const ref = {
    ...codexUserMessageInput({ externalSessionId: summary.externalSessionId, parts: [] }),
    speed: "priority-example",
  };
  const release = await adapter.holdSessionTurns(ref, ref);
  transport.onSettingsUpdate = () => {};
  let accepted = false;
  const changing = adapter.updateSessionSpeed(ref).then(() => {
    accepted = true;
  });
  await flushCodexAdapterWork();
  old.emitNotification(settingsReport("priority-example"));
  await flushCodexAdapterWork();
  expect(accepted).toBe(false);
  report("priority-example");
  await changing;
  adapter.setSessionSpeedState(ref, initialSpeedState("priority-example", "confirmed"));
  await release();
});

test("a saved off report publishes its snapshot and clears the turn block after publication fails", async () => {
  const { adapter, transport, report, saved, failures, mutations } = harness(async () => {
    throw new Error("Publication failed");
  });
  const summary = await adapter.startSession(
    codexStartSessionInput({ model: { providerId: "codex", modelId: "gpt-5" } }),
  );
  const ref = codexUserMessageInput({ externalSessionId: summary.externalSessionId, parts: [] });
  adapter.setSessionSpeedState(ref, initialSpeedState(null, "uncertain"));
  mutations.length = 0;
  report(null);
  await flushCodexAdapterWork();
  expect(saved).toEqual(["standard"]);
  expect(failures).toHaveLength(1);
  expect(String(failures[0])).toContain("Publication failed");
  expect(mutations).toHaveLength(1);
  expect(mutations[0]?.snapshots).toContainEqual(
    expect.objectContaining({
      ref: expect.objectContaining({ externalSessionId: summary.externalSessionId }),
      speed: expect.objectContaining({ choice: "standard", synchronization: "confirmed" }),
    }),
  );
  expect(adapter.listLiveSessionSnapshots("runtime-live")[0]?.speed).toMatchObject({
    choice: "standard",
    synchronization: "confirmed",
  });
  await adapter.sendUserMessage({
    ...ref,
    speed: "standard",
    parts: [{ kind: "text", text: "Continue" }],
  });
  expect(
    transport.calls.find((call) => call.method === "turn/start")?.params.serviceTier,
  ).toBeNull();
});

test("an in-flight report retains its session identity through a runtime replacement", async () => {
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const transport = new FastTransport("runtime-live", false);
  const stream = createRuntimeStreamSubscription();
  const owners: boolean[] = [];
  const adapter = createAdapterWithTransport(transport, {
    subscribeEvents: stream.subscribeEvents,
    recordSpeedChoice: async (_ref, _choice, isCurrent) => {
      owners.push(isCurrent());
      entered.resolve();
      await finish.promise;
      owners.push(isCurrent());
      throw new Error("Session was released before saving");
    },
  });
  const input = codexStartSessionInput({
    speed: "priority-example",
    model: { providerId: "codex", modelId: "gpt-5" },
  });
  const summary = await adapter.startSession(input);
  stream.emitNotification(settingsReport(null, summary.externalSessionId));
  await entered.promise;
  adapter.releaseRuntime("runtime-live");
  await adapter.resumeSession({ ...input, externalSessionId: summary.externalSessionId });
  finish.resolve();
  await flushCodexAdapterWork();
  expect(owners).toEqual([true, false]);
  expect(adapter.listLiveSessionSnapshots("runtime-live")[0]?.speed).toMatchObject({
    choice: "priority-example",
    synchronization: "confirmed",
  });
  expect(transport.calls.filter((call) => call.method === "thread/settings/update")).toEqual([]);
});

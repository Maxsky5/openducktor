import { expect, test } from "bun:test";
import { initialSpeedState, type AgentModelSelection } from "@openducktor/core";
import type { CodexLiveSessionMutation } from "./types";
import {
  codexStartSessionInput,
  codexUserMessageInput,
  createAdapterWithTransport,
  createRuntimeStreamSubscription,
  flushCodexAdapterWork,
} from "./codex-app-server-adapter.test-harness";
import { FastTransport, settingsReport } from "./codex-app-server-adapter.speed.test-harness";

test("keeps received order when a hold starts before queued reports run", async () => {
  const transport = new FastTransport("runtime-live", false);
  const stream = createRuntimeStreamSubscription();
  const saved: Array<AgentModelSelection | undefined> = [];
  const adapter = createAdapterWithTransport(transport, {
    subscribeEvents: stream.subscribeEvents,
    recordSpeedChoice: async (_ref, _choice, _isCurrent, model) => {
      saved.push(model);
      return async () => {};
    },
  });
  const summary = await adapter.startSession(codexStartSessionInput());
  const ref = codexUserMessageInput({ externalSessionId: summary.externalSessionId, parts: [] });
  const report = (model: string, effort: string) => {
    stream.emitNotification(settingsReport(null, summary.externalSessionId, model, effort));
  };
  report("gpt-5.1", "high");
  report("gpt-5", "medium");
  const holding = adapter.holdSessionTurns(ref, ref);
  report("gpt-5.1", "high");
  const release = await holding;
  await release();
  expect(saved.map((model) => [model?.modelId, model?.variant])).toEqual([
    ["gpt-5.1", "high"],
    ["gpt-5", "medium"],
    ["gpt-5.1", "high"],
  ]);
});

test.each(["native report", "speed acknowledgement", "rollback acknowledgement"] as const)(
  "saves the held model from a %s before admitting the next turn",
  async (path) => {
    const entered = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const transport = new FastTransport("runtime-live", false);
    transport.extraModels = ["gpt-5.1"];
    const stream = createRuntimeStreamSubscription();
    const mutations: CodexLiveSessionMutation[] = [];
    const saved: Array<[string | null, AgentModelSelection | undefined]> = [];
    const adapter = createAdapterWithTransport(transport, {
      subscribeEvents: stream.subscribeEvents,
      recordSpeedChoice: async (_ref, choice, _isCurrent, model) => {
        entered.resolve();
        await finish.promise;
        saved.push([choice, model]);
        return async () => {};
      },
      onLiveSessionMutation: (mutation) => {
        mutations.push(mutation);
      },
    });
    const summary = await adapter.startSession(
      codexStartSessionInput({
        model: { providerId: "codex", modelId: "gpt-5", variant: "medium" },
      }),
    );
    const ref = codexUserMessageInput({ externalSessionId: summary.externalSessionId, parts: [] });
    const release = await adapter.holdSessionTurns(ref, ref);
    const report = (tier: string | null) => {
      stream.emitNotification(settingsReport(tier, summary.externalSessionId, "gpt-5.1", "high"));
    };
    if (path !== "native report") {
      transport.onSettingsUpdate = (tier) => report(tier);
      await adapter.updateSessionSpeed({ ...ref, speed: "priority-example" });
      adapter.setSessionSpeedState(ref, initialSpeedState("priority-example", "confirmed"));
      if (path === "rollback acknowledgement") {
        await adapter.updateSessionSpeed({ ...ref, speed: "standard" });
        adapter.setSessionSpeedState(ref, initialSpeedState("standard", "confirmed"));
      }
    } else report(null);
    await flushCodexAdapterWork();
    expect(saved).toEqual([]);
    const releasing = release();
    const completed = releasing.then(() => "released" as const);
    const state = await Promise.race([entered.promise.then(() => "saving" as const), completed]);
    try {
      expect(state).toBe("saving");
      await expect(
        adapter.sendUserMessage({
          ...ref,
          speed: "standard",
          parts: [{ kind: "text", text: "Wait" }],
        }),
      ).rejects.toThrow("pending");
      expect(transport.calls.filter((call) => call.method === "turn/start")).toHaveLength(0);
    } finally {
      finish.resolve();
      await releasing;
    }
    const choice = path === "speed acknowledgement" ? "priority-example" : "standard";
    expect(saved).toEqual([
      [choice, expect.objectContaining({ modelId: "gpt-5.1", variant: "high" })],
    ]);
    expect(mutations.flatMap((mutation) => mutation.snapshots)).toContainEqual(
      expect.objectContaining({
        model: expect.objectContaining({ modelId: "gpt-5.1", variant: "high" }),
        speed: expect.objectContaining({ choice, synchronization: "confirmed" }),
      }),
    );
    await adapter.sendUserMessage({
      ...ref,
      model: saved[0]?.[1],
      speed: choice,
      parts: [{ kind: "text", text: "Continue" }],
    });
    expect(transport.calls.find((call) => call.method === "turn/start")?.params).toMatchObject({
      model: "gpt-5.1",
      effort: "high",
      serviceTier: choice === "standard" ? null : choice,
    });
  },
);

test.each([false, true])(
  "a local acknowledgement keeps the chosen model after rollback: %s",
  async (rollback) => {
    const transport = new FastTransport("runtime-live", false);
    transport.extraModels = ["gpt-5.1"];
    const stream = createRuntimeStreamSubscription();
    const saved: AgentModelSelection[] = [];
    const adapter = createAdapterWithTransport(transport, {
      subscribeEvents: stream.subscribeEvents,
      recordSpeedChoice: async (_ref, _choice, _isCurrent, model) => {
        if (model) saved.push(model);
        return async () => {};
      },
    });
    const summary = await adapter.startSession(codexStartSessionInput());
    const ref = codexUserMessageInput({ externalSessionId: summary.externalSessionId, parts: [] });
    const release = await adapter.holdSessionTurns(ref, ref);
    const selected = {
      providerId: "codex",
      modelId: "gpt-5.1",
      variant: "high",
      profileId: "review-agent",
    };
    await adapter.updateSessionModel({ ...ref, model: selected });
    transport.onSettingsUpdate = (tier) =>
      stream.emitNotification(settingsReport(tier, summary.externalSessionId));
    await adapter.updateSessionSpeed({ ...ref, speed: "priority-example" });
    adapter.setSessionSpeedState(ref, initialSpeedState("priority-example", "confirmed"));
    if (rollback) {
      await adapter.updateSessionModel({
        ...ref,
        model: { ...selected, modelId: "gpt-5", variant: "medium" },
      });
      await adapter.updateSessionSpeed({ ...ref, speed: "standard" });
      adapter.setSessionSpeedState(ref, initialSpeedState("standard", "confirmed"));
    }
    await release();
    await flushCodexAdapterWork();
    expect(saved).toEqual([]);
    expect(adapter.listLiveSessionSnapshots("runtime-live")[0]?.model).toEqual(
      rollback ? { ...selected, modelId: "gpt-5", variant: "medium" } : selected,
    );
    expect(adapter.listLiveSessionSnapshots("runtime-live")[0]?.speed?.choice).toBe(
      rollback ? "standard" : "priority-example",
    );
  },
);

test.each(["session", "runtime"] as const)(
  "a held report cannot change a replacement %s",
  async (owner) => {
    const transport = new FastTransport("runtime-live", false);
    const stream = createRuntimeStreamSubscription();
    const saved: Array<string | null> = [];
    const faults: string[] = [];
    const adapter = createAdapterWithTransport(transport, {
      subscribeEvents: stream.subscribeEvents,
      recordSpeedChoice: async (_ref, choice) => {
        saved.push(choice);
        return async () => {};
      },
      onLiveSessionMutation: (mutation) => {
        if (mutation.fault) faults.push(mutation.fault);
      },
    });
    const summary = await adapter.startSession(codexStartSessionInput());
    const ref = codexUserMessageInput({ externalSessionId: summary.externalSessionId, parts: [] });
    const release = await adapter.holdSessionTurns(ref, ref);
    stream.emitNotification(settingsReport(null, summary.externalSessionId, "gpt-5.1", "high"));
    await flushCodexAdapterWork();
    if (owner === "runtime") adapter.releaseRuntime("runtime-live");
    else await adapter.releaseSession(ref);
    await adapter.resumeSession({
      ...codexStartSessionInput(),
      externalSessionId: summary.externalSessionId,
    });
    const releaseReplacement = await adapter.holdSessionTurns(ref, ref);
    await release();
    await releaseReplacement();
    await flushCodexAdapterWork();
    expect(saved).toEqual([]);
    expect(faults).toEqual([]);
    expect(adapter.listLiveSessionSnapshots("runtime-live")[0]?.model?.modelId).toBe("gpt-5");
    expect(transport.calls.filter((call) => call.method === "thread/settings/update")).toEqual([]);
  },
);

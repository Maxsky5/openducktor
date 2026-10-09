import { expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { initialSpeedState, type AgentEvent, type AgentModelSelection } from "@openducktor/core";
import type { Query } from "@anthropic-ai/claude-agent-sdk";
import { consumeClaudeSession } from "./claude-agent-sdk-session-io";
import { applyClaudeSessionModel } from "./claude-agent-sdk-session-dispatch";
import {
  createClaudeQueryFixture,
  createClaudeSession,
  ignoreClaudeBackgroundFailure,
  openClaudeQueryWithMessages,
} from "./claude-agent-sdk-session-io.test-support";
import { createClaudeAgentSdkSessionStore } from "./claude-agent-sdk-session-store";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";
import { ClaudeSessionSpeedControl } from "./claude-session-speed-control";
import { observeClaudeSessionModel } from "./claude-session-speed-preparation";

test.each([
  { supportsFastMode: true, held: false },
  { supportsFastMode: false, held: false },
  { supportsFastMode: true, held: true },
  { supportsFastMode: false, held: true },
])(
  "keeps the stream and saved fallback model after publication fails (fast: $supportsFastMode, held: $held)",
  async ({ supportsFastMode, held }) => {
    const processed = Promise.withResolvers<void>();
    const events: AgentEvent[] = [];
    const failures: string[] = [];
    let savedModel = { providerId: "claude", modelId: "opus" };
    let savedChoice: string | null = "fast";
    const { query, release: closeStream } = openClaudeQueryWithMessages([
      claudeSdkMessageFixture({
        type: "system",
        subtype: "model_refusal_fallback",
        scope: "session",
        original_model: "opus",
        fallback_model: "sonnet",
      }),
      {
        type: "system",
        subtype: "notification",
        key: "after-model-report",
        text: "Stream continues",
        priority: "high",
        uuid: "00000000-0000-4000-8000-000000000003",
        session_id: "session-1",
      },
    ]);
    const flags = mock(async () => {});
    const session = createClaudeSession({
      model: savedModel,
      nativeModel: { modelId: "opus" },
      summary: { ...createClaudeSession().summary, speed: initialSpeedState("fast", "confirmed") },
      query: createClaudeQueryFixture(
        Object.assign(query, {
          applyFlagSettings: flags,
          supportedModels: async () => [
            { value: "sonnet", displayName: "Sonnet", description: "Sonnet", supportsFastMode },
          ],
        }),
      ),
      recordSpeedChoice: async (choice, model) => {
        savedChoice = choice;
        if (model) savedModel = model;
        return async () => {
          throw new Error("Publication failed");
        };
      },
    });
    const sessionStore = createClaudeAgentSdkSessionStore();
    sessionStore.set(session);
    const emit: Parameters<typeof consumeClaudeSession>[0]["emit"] = (_session, event) => {
      events.push(event);
      if (event.type === "session_policy_notice" || event.type === "session_finished")
        processed.resolve();
    };
    const onBackgroundFailure: Parameters<typeof consumeClaudeSession>[0]["onBackgroundFailure"] = (
      error,
    ) =>
      Effect.sync(() => {
        failures.push(error.message);
      });
    const control = new ClaudeSessionSpeedControl({
      findSession: sessionStore.get,
      requireSession: () => session,
      createSession: () => Effect.die(new Error("Unexpected attachment")),
      emit,
      now: () => "2026-10-09T00:00:00Z",
      onBackgroundFailure,
    });
    const release = held
      ? await Effect.runPromise(
          control.holdSessionTurns(
            {
              ...session.input,
              runtimeKind: "claude",
              externalSessionId: session.externalSessionId,
            },
            session.runtimeId,
          ),
        )
      : undefined;
    const reading = consumeClaudeSession({
      session,
      sessionStore,
      emit,
      now: () => "2026-10-09T00:00:00Z",
      onBackgroundFailure,
    });
    try {
      await processed.promise;
      if (release) await Effect.runPromise(release);
      expect(sessionStore.get(session.externalSessionId)).toBe(session);
      expect(savedModel.modelId).toBe("sonnet");
      expect(session.model?.modelId).toBe("sonnet");
      expect(savedChoice).toBe(supportsFastMode ? "fast" : "standard");
      expect(session.summary.speed).toMatchObject({
        choice: savedChoice,
        synchronization: "confirmed",
      });
      expect(failures).toEqual([expect.stringContaining("Publication failed")]);
      expect(events).toContainEqual(
        expect.objectContaining({ type: "session_policy_notice", message: "Stream continues" }),
      );
      expect(
        events.some((event) => event.type === "session_error" || event.type === "session_finished"),
      ).toBe(false);
      await expect(session.turnAdmission.run(async () => "admitted")).resolves.toBe("admitted");
      if (!supportsFastMode) expect(flags).toHaveBeenCalledWith({ fastMode: false });
    } finally {
      closeStream();
      await reading;
    }
  },
);

test.each([
  ...[
    { label: "accepted settings", scope: "session" as const, failSettings: false, init: false },
    { label: "rolled-back settings", scope: undefined, failSettings: true, init: false },
    { label: "local reports", scope: "local" as const, failSettings: false, init: false },
    { label: "accepted effort", scope: "session" as const, failSettings: false, init: true },
    { label: "rolled-back effort", scope: "session" as const, failSettings: true, init: true },
  ].map((path) => ({ ...path, repeat: false, back: false })),
  {
    label: "a repeated init",
    scope: "session" as const,
    failSettings: false,
    init: true,
    repeat: true,
    back: false,
  },
  {
    label: "effort returning to its first value",
    scope: "session" as const,
    failSettings: false,
    init: true,
    repeat: false,
    back: true,
  },
])("holds reports through $label", async ({ scope, failSettings, init, repeat, back }) => {
  const entered = Promise.withResolvers<void>();
  const finishSettings = Promise.withResolvers<void>();
  const readReports = Promise.withResolvers<void>();
  const closeStream = Promise.withResolvers<void>();
  const order: string[] = [];
  const save = mock(async (_choice: string | null, model?: AgentModelSelection) => {
    order.push(`save:${model?.modelId}`);
    return async () => {
      order.push(`publish:${model?.modelId}`);
    };
  });
  const flags = mock<Query["applyFlagSettings"]>(async (settings) => {
    if (settings.effortLevel === "low") {
      entered.resolve();
      await finishSettings.promise;
      if (failSettings) throw new Error("Effort rejected");
    }
  });
  const sessionStore = createClaudeAgentSdkSessionStore();
  const session = createClaudeSession({
    model: { providerId: "claude", modelId: "opus", variant: "high", profileId: "review-agent" },
    nativeModel: { modelId: "opus", effort: "high" },
    summary: { ...createClaudeSession().summary, speed: initialSpeedState("fast", "confirmed") },
    recordSpeedChoice: save,
    query: createClaudeQueryFixture(
      Object.assign(
        (async function* () {
          await entered.promise;
          const reports = back
            ? ([
                ["opus", "medium"],
                ["opus", "high"],
              ] as const)
            : repeat
              ? ([["opus", "high"]] as const)
              : ([
                  ["sonnet", "medium"],
                  ["haiku", null],
                ] as const);
          for (const [model, effort] of reports) {
            if (init) {
              yield claudeSdkMessageFixture({ type: "system", subtype: "init", model, effort });
              continue;
            }
            const report: Parameters<typeof claudeSdkMessageFixture>[0] = {
              type: "system",
              subtype: "model_refusal_fallback",
              original_model: "opus",
              fallback_model: model,
            };
            if (scope !== undefined) report.scope = scope;
            yield claudeSdkMessageFixture(report);
          }
          readReports.resolve();
          await closeStream.promise;
        })(),
        {
          applyFlagSettings: flags,
          supportedModels: async () =>
            ["opus", "sonnet", "haiku"].map((value) => ({
              value,
              displayName: value,
              description: value,
              supportsFastMode: value === "opus",
            })),
        },
      ),
    ),
    queuedSdkMessages: [
      {
        type: "user",
        uuid: "11111111-2222-3333-4444-555555555555",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: { role: "user", content: "Wait for the model report" },
      },
    ],
  });
  session.queue.push = () => {
    order.push(`turn:${session.model?.modelId}:${session.summary.speed.choice}`);
  };
  sessionStore.set(session);
  const control = new ClaudeSessionSpeedControl({
    findSession: sessionStore.get,
    requireSession: () => session,
    createSession: () => Effect.die(new Error("Unexpected attachment")),
    emit: () => {},
    now: () => "2026-10-09T00:00:00Z",
    onBackgroundFailure: ignoreClaudeBackgroundFailure,
  });
  const release = await Effect.runPromise(
    control.holdSessionTurns(
      {
        ...session.input,
        runtimeKind: "claude",
        externalSessionId: session.externalSessionId,
      },
      session.runtimeId,
    ),
  );
  const reading = consumeClaudeSession({
    session,
    sessionStore,
    emit: () => {},
    now: () => "2026-10-09T00:00:00Z",
    onBackgroundFailure: ignoreClaudeBackgroundFailure,
  });
  const changing = applyClaudeSessionModel(session, {
    providerId: "claude",
    modelId: "opus",
    variant: "low",
    profileId: "review-agent",
  });
  try {
    await readReports.promise;
    expect(order).toEqual([]);
    finishSettings.resolve();
    if (failSettings) await expect(changing).rejects.toThrow("Effort rejected");
    else await changing;
    await Effect.runPromise(release);
    if (scope === "local" || repeat) {
      expect(save).not.toHaveBeenCalled();
      expect(order).toEqual(["turn:opus:fast"]);
      expect(session.nativeModel?.modelId).toBe("opus");
      expect(session.model?.variant).toBe("low");
    } else if (back) {
      expect(order).toEqual([
        "save:opus",
        "publish:opus",
        "save:opus",
        "publish:opus",
        "turn:opus:fast",
      ]);
      expect(save.mock.calls.map(([choice, model]) => [choice, model?.variant])).toEqual([
        ["fast", "medium"],
        ["fast", "high"],
      ]);
      expect(session.model?.variant).toBe("high");
      expect(session.nativeModel).toEqual({ modelId: "opus", effort: "high" });
    } else {
      expect(save.mock.calls.map(([choice, model]) => [choice, model?.modelId])).toEqual([
        ["standard", "sonnet"],
        ["standard", "haiku"],
      ]);
      expect(order).toEqual([
        "save:sonnet",
        "publish:sonnet",
        "save:haiku",
        "publish:haiku",
        "turn:haiku:standard",
      ]);
      expect(session.nativeModel?.modelId).toBe("haiku");
      expect(session.model).toMatchObject({
        modelId: "haiku",
        profileId: "review-agent",
      });
      expect(session.model?.variant).toBe(init ? undefined : failSettings ? "high" : "low");
      expect(save.mock.calls.map(([, model]) => model?.variant)).toEqual(
        init ? ["medium", undefined] : failSettings ? ["high", "high"] : ["low", "low"],
      );
      expect(flags).toHaveBeenCalledWith({ fastMode: false });
    }
  } finally {
    finishSettings.resolve();
    closeStream.resolve();
    await reading;
  }
});

test.each([
  { path: "save failure", choice: "fast" },
  { path: "released session", choice: "fast" },
  { path: "unresolved speed save failure", choice: null },
] as const)(
  "$path cannot release a queued turn with a stale native model",
  async ({ path, choice }) => {
    const flags = mock(async () => {});
    const save = mock(async () => {
      throw new Error("Store unavailable");
    });
    const sessionStore = createClaudeAgentSdkSessionStore();
    const session = createClaudeSession({
      model: { providerId: "claude", modelId: "opus" },
      summary: {
        ...createClaudeSession().summary,
        speed: initialSpeedState(choice, choice === null ? "unapplied" : "confirmed"),
      },
      recordSpeedChoice: save,
      query: createClaudeQueryFixture({
        applyFlagSettings: flags,
        supportedModels: async () => [
          {
            value: "sonnet",
            displayName: "Sonnet",
            description: "Sonnet",
            supportsFastMode: false,
          },
        ],
      }),
      queuedSdkMessages: [
        {
          type: "user",
          uuid: "11111111-2222-3333-4444-555555555555",
          session_id: "session-1",
          parent_tool_use_id: null,
          message: { role: "user", content: "Keep this queued" },
        },
      ],
    });
    const push = mock(() => {});
    session.queue.push = push;
    sessionStore.set(session);
    const control = new ClaudeSessionSpeedControl({
      findSession: sessionStore.get,
      requireSession: () => session,
      createSession: () => Effect.die(new Error("Unexpected attachment")),
      emit: () => {},
      now: () => "2026-10-09T00:00:00Z",
      onBackgroundFailure: ignoreClaudeBackgroundFailure,
    });
    const release = await Effect.runPromise(
      control.holdSessionTurns(
        { ...session.input, runtimeKind: "claude", externalSessionId: session.externalSessionId },
        session.runtimeId,
      ),
    );
    await observeClaudeSessionModel(
      session,
      { modelId: "sonnet" },
      () => {},
      "2026-10-09T00:00:00Z",
      ignoreClaudeBackgroundFailure,
    );
    if (path === "released session") {
      const replacement = createClaudeSession();
      sessionStore.set(replacement);
      await Effect.runPromise(release);
      expect(sessionStore.get(session.externalSessionId)).toBe(replacement);
      expect(save).not.toHaveBeenCalled();
      expect(flags).not.toHaveBeenCalled();
    } else {
      await expect(Effect.runPromise(release)).rejects.toThrow("Store unavailable");
      expect(save).toHaveBeenCalled();
      expect(session.model?.modelId).toBe("sonnet");
      expect(session.summary.speed.synchronization).toBe("unapplied");
      await expect(session.turnAdmission.run(async () => {})).rejects.toThrow("pending");
    }
    expect(push).not.toHaveBeenCalled();
    expect(session.queuedSdkMessages).toHaveLength(1);
  },
);

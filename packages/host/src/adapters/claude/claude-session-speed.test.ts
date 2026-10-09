import { expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { initialSpeedState, SessionTurnAdmission } from "@openducktor/core";
import type { ModelInfo, Query } from "@anthropic-ai/claude-agent-sdk";
import {
  createClaudeQueryFixture,
  createClaudeSession,
  ignoreClaudeBackgroundFailure,
} from "./claude-agent-sdk-session-io.test-support";
import {
  commitClaudeSessionChoiceReport,
  observeClaudeSpeed,
} from "./claude-session-speed-observation";
import { observeClaudeSessionModel } from "./claude-session-speed-preparation";
import {
  restoreClaudeSessionModelAfterQueuedTurns,
  applyClaudeSessionModel,
} from "./claude-agent-sdk-session-dispatch";
import { ClaudeSessionSpeedControl } from "./claude-session-speed-control";

test.each(["opus", "claude-opus-5-5"])(
  "allows SDK opt-in for %s and a fresh request after rejection",
  async (modelId) => {
    const flags = mock<Query["applyFlagSettings"]>(async () => {});
    const session = createClaudeSession({
      model: { providerId: "claude", modelId },
      summary: {
        ...createClaudeSession().summary,
        speed: initialSpeedState("standard", "confirmed"),
      },
      query: createClaudeQueryFixture({
        applyFlagSettings: flags,
        supportedModels: async () => [
          {
            value: "opus",
            resolvedModel: "claude-opus-5-5",
            displayName: "Opus",
            description: "Opus",
            supportsFastMode: true,
          },
        ],
      }),
    });
    const control = new ClaudeSessionSpeedControl({
      findSession: () => session,
      requireSession: () => session,
      createSession: () => Effect.die(new Error("unexpected attach")),
      now: () => "2026-10-08T00:00:00Z",
      emit: () => {},
      onBackgroundFailure: ignoreClaudeBackgroundFailure,
    });
    const ref = {
      repoPath: "/repo",
      workingDirectory: "/repo",
      runtimeKind: "claude" as const,
      externalSessionId: session.externalSessionId,
      sessionScope: session.input.sessionScope,
    };
    const report = {
      fast_mode_state: "off" as const,
      fast_mode_disabled_reason: "sdk_opt_in_required" as const,
    };

    observeClaudeSpeed(session, report, true);
    expect(session.summary.speed.availability).toEqual({ status: "available" });
    const enabled = await Effect.runPromise(control.updateSessionSpeed({ ...ref, speed: "fast" }));
    await Effect.runPromise(
      control.setSessionSpeedState(ref, {
        ...initialSpeedState("fast", "confirmed"),
        availability: enabled.availability,
      }),
    );

    observeClaudeSpeed(session, report, true);
    expect(session.summary.speed.choice).toBe("fast");
    expect(session.summary.speed.availability).toMatchObject({
      status: "blocked",
      reason: { code: "sdk_opt_in_required" },
    });
    const disabled = await Effect.runPromise(
      control.updateSessionSpeed({ ...ref, speed: "standard" }),
    );
    expect(disabled.availability).toEqual({ status: "available" });
    await Effect.runPromise(
      control.setSessionSpeedState(ref, {
        ...initialSpeedState("standard", "confirmed"),
        availability: disabled.availability,
      }),
    );
    const retried = await Effect.runPromise(control.updateSessionSpeed({ ...ref, speed: "fast" }));
    expect(retried.reportedChoice).toBe("fast");
    expect(flags.mock.calls).toEqual([
      [{ fastMode: true }],
      [{ fastMode: false }],
      [{ fastMode: true }],
    ]);
  },
);

test.each([
  {
    label: "blocked enablement",
    choice: "standard",
    synchronization: "confirmed" as const,
    supported: true,
  },
  {
    label: "unapplied restoration",
    choice: "fast",
    synchronization: "unapplied" as const,
    supported: true,
  },
  {
    label: "uncertain restoration",
    choice: "fast",
    synchronization: "uncertain" as const,
    supported: true,
  },
  {
    label: "an unsupported target",
    choice: "fast",
    synchronization: "confirmed" as const,
    supported: false,
  },
])(
  "does not treat $label as retaining an established supported choice",
  async ({ choice, synchronization, supported }) => {
    const flags = mock(async () => {});
    const state = {
      ...initialSpeedState(choice, synchronization),
      availability: {
        status: "blocked" as const,
        reason: { code: "extra_usage_disabled", message: "Fast mode requires usage credits." },
      },
    };
    const session = createClaudeSession({
      model: { providerId: "claude", modelId: "opus" },
      summary: { ...createClaudeSession().summary, speed: state },
      query: createClaudeQueryFixture({
        applyFlagSettings: flags,
        supportedModels: async () => [
          { value: "opus", displayName: "Opus", description: "Opus", supportsFastMode: supported },
        ],
      }),
    });
    const control = new ClaudeSessionSpeedControl({
      findSession: () => session,
      requireSession: () => session,
      createSession: () => Effect.die(new Error("unexpected attach")),
      now: () => "2026-10-08T00:00:00Z",
      emit: () => {},
      onBackgroundFailure: ignoreClaudeBackgroundFailure,
    });
    await expect(
      Effect.runPromise(
        control.updateSessionSpeed(
          {
            repoPath: "/repo",
            workingDirectory: "/repo",
            runtimeKind: "claude",
            externalSessionId: session.externalSessionId,
            sessionScope: session.input.sessionScope,
            speed: "fast",
          },
          state,
        ),
      ),
    ).rejects.toThrow(
      supported ? "Fast mode requires usage credits." : "does not report speed support",
    );
    expect(flags).not.toHaveBeenCalled();
    expect(session.summary.speed).toEqual(state);
  },
);

test("native explicit off commits, but cooldown and account limits retain on", async () => {
  const save = mock(async () => async () => {});
  const session = createClaudeSession({
    summary: { ...createClaudeSession().summary, speed: initialSpeedState("fast", "confirmed") },
    recordSpeedChoice: save,
  });
  await commitClaudeSessionChoiceReport(
    session,
    { fast_mode_state: "cooldown" },
    ignoreClaudeBackgroundFailure,
  );
  await commitClaudeSessionChoiceReport(
    session,
    {
      fast_mode_state: "off",
      fast_mode_disabled_reason: "free",
    },
    ignoreClaudeBackgroundFailure,
  );
  expect(save).not.toHaveBeenCalled();
  await commitClaudeSessionChoiceReport(
    session,
    {
      fast_mode_state: "off",
      fast_mode_disabled_reason: "preference",
    },
    ignoreClaudeBackgroundFailure,
  );
  expect(save).toHaveBeenCalledWith("standard", undefined, "fast");
  expect(session.summary.speed).toMatchObject({ choice: "standard", synchronization: "confirmed" });
});

test("native explicit off restores on if its durable save fails", async () => {
  const flags = mock(async () => {});
  const session = createClaudeSession({
    summary: { ...createClaudeSession().summary, speed: initialSpeedState("fast", "confirmed") },
    query: createClaudeQueryFixture({ applyFlagSettings: flags }),
    recordSpeedChoice: async () => {
      throw new Error("Store unavailable");
    },
  });
  await expect(
    commitClaudeSessionChoiceReport(
      session,
      { fast_mode_state: "off" },
      ignoreClaudeBackgroundFailure,
    ),
  ).rejects.toThrow("Store unavailable");
  expect(flags).toHaveBeenCalledWith({ fastMode: true });
  expect(session.summary.speed).toMatchObject({ choice: "fast", synchronization: "confirmed" });
});

test("a later authoritative report resolves an imported unknown choice before new work", async () => {
  const save = mock(async () => async () => {});
  const admission = new SessionTurnAdmission();
  admission.setBlocked(true);
  const session = createClaudeSession({
    summary: { ...createClaudeSession().summary, speed: initialSpeedState(null) },
    speedInitialized: true,
    turnAdmission: admission,
    recordSpeedChoice: save,
  });
  await commitClaudeSessionChoiceReport(
    session,
    { fast_mode_state: "on" },
    ignoreClaudeBackgroundFailure,
  );
  expect(save).toHaveBeenCalledWith("fast", undefined, null);
  expect(session.summary.speed).toMatchObject({ choice: "fast", synchronization: "confirmed" });
  await expect(admission.run(async () => "admitted")).resolves.toBe("admitted");
});

test.each([false, undefined])(
  "a native model with speed flag %s resets and saves off",
  async (flag) => {
    const save = mock(async () => async () => {});
    const flags = mock(async () => {});
    const model: ModelInfo = {
      value: "sonnet",
      resolvedModel: "claude-sonnet-5-5",
      displayName: "Sonnet",
      description: "Sonnet",
    };
    if (flag !== undefined) model.supportsFastMode = flag;
    const session = createClaudeSession({
      model: { providerId: "anthropic", modelId: "opus", profileId: "review-agent" },
      summary: { ...createClaudeSession().summary, speed: initialSpeedState("fast", "confirmed") },
      query: createClaudeQueryFixture({
        applyFlagSettings: flags,
        supportedModels: async () => [model],
      }),
      recordSpeedChoice: save,
    });
    await observeClaudeSessionModel(
      session,
      { modelId: "claude-sonnet-5-5" },
      () => {},
      "2026-10-08T00:00:00Z",
      ignoreClaudeBackgroundFailure,
    );
    expect(flags).toHaveBeenCalledWith({ fastMode: false });
    expect(save).toHaveBeenCalledWith("standard", {
      providerId: "anthropic",
      modelId: "claude-sonnet-5-5",
      profileId: "review-agent",
    });
    expect(session.summary.speed.choice).toBe("standard");
  },
);

test("queued model restoration finishes before a newer settings change can enter", async () => {
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const admission = new SessionTurnAdmission();
  const session = createClaudeSession({
    model: { providerId: "anthropic", modelId: "queued" },
    modelAfterQueuedTurns: { providerId: "anthropic", modelId: "original" },
    summary: {
      ...createClaudeSession().summary,
      speed: initialSpeedState("standard", "confirmed"),
    },
    turnAdmission: admission,
    query: createClaudeQueryFixture({
      setModel: async (model) => {
        if (model === "original") {
          entered.resolve();
          await resume.promise;
        }
      },
    }),
  });
  const restoring = restoreClaudeSessionModelAfterQueuedTurns(
    session,
    () => {},
    "2026-10-08T00:00:00Z",
  );
  await entered.promise;
  let held = false;
  const holding = admission.hold().then((release) => {
    held = true;
    return release;
  });
  await Promise.resolve();
  expect(held).toBe(false);
  resume.resolve();
  await restoring;
  const release = await holding;
  await applyClaudeSessionModel(session, { providerId: "anthropic", modelId: "newer" });
  release();
  expect(session.model?.modelId).toBe("newer");
  expect(session.modelAfterQueuedTurns).toBeUndefined();
});

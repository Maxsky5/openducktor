import { describe, expect, test } from "bun:test";
import type {
  AgentToolPart,
  CodexAppServerAutoApprovalReviewCompletedParams,
} from "@openducktor/contracts";
import { z } from "zod";
import type { AgentEvent } from "@openducktor/core";
import {
  codexSessionRef,
  codexStartSessionInput,
  codexTurnFixture,
  codexUserMessageInput,
  createHarness,
  createRuntimeStreamSubscription,
  flushCodexAdapterWork,
} from "./codex-app-server-adapter.test-harness";
import type { CodexLiveSessionMutation } from "./index";
import type { CodexAppServerAdapterOptions } from "./types";
import { codexCommandExecutionItemFixture } from "./test-fixtures/codex-protocol";
import { codexImageGenerationPart } from "./codex-image-generation";

const THREAD_ID = "thread/start-runtime-live";
const RUNTIME_ID = "runtime-live";

const commandAction = { type: "command", source: "shell", command: "rm -rf build", cwd: "/repo" };

const reviewNotification = (
  overrides: {
    reviewId?: string;
    targetItemId?: string | null;
    status?: string;
    rationale?: string | null;
    riskLevel?: string | null;
    action?: CodexAppServerAutoApprovalReviewCompletedParams["action"];
  } = {},
) => ({
  method: "item/autoApprovalReview/completed",
  params: {
    threadId: THREAD_ID,
    turnId: "turn-live",
    reviewId: overrides.reviewId ?? "review-1",
    startedAtMs: 1_000,
    completedAtMs: 2_000,
    decisionSource: "agent",
    targetItemId: overrides.targetItemId === undefined ? "command-1" : overrides.targetItemId,
    review: {
      status: overrides.status ?? "denied",
      riskLevel: overrides.riskLevel === undefined ? "high" : overrides.riskLevel,
      userAuthorization: "low",
      rationale:
        overrides.rationale === undefined ? "Deletes the build output." : overrides.rationale,
    },
    action: overrides.action ?? commandAction,
  },
});

const startedCommand = (status: "inProgress" | "declined" = "inProgress") => ({
  method: status === "inProgress" ? "item/started" : "item/completed",
  params: {
    threadId: THREAD_ID,
    turnId: "turn-live",
    ...(status === "inProgress" ? { startedAtMs: 1_000 } : { completedAtMs: 2_000 }),
    item: codexCommandExecutionItemFixture({
      id: "command-1",
      command: "rm -rf build",
      status,
      exitCode: null,
      aggregatedOutput: null,
    }),
  },
});

const setup = async (
  options: {
    deferTurnStart?: boolean;
    respondServerRequest?: CodexAppServerAdapterOptions["respondServerRequest"];
  } = {},
) => {
  const stream = createRuntimeStreamSubscription();
  const mutations: CodexLiveSessionMutation[] = [];
  const failures: unknown[] = [];
  const overrides: Partial<CodexAppServerAdapterOptions> = {
    subscribeEvents: stream.subscribeEvents,
    onLiveSessionMutation: (mutation) => {
      mutations.push(mutation);
    },
    onRuntimeEventQueueFailure: (failure) => {
      failures.push(failure);
    },
  };
  if (options.respondServerRequest) overrides.respondServerRequest = options.respondServerRequest;
  const harness = createHarness(overrides, { deferTurnStart: options.deferTurnStart ?? false });
  await harness.adapter.prepareRuntime(RUNTIME_ID);
  await harness.adapter.startSession(codexStartSessionInput());
  await flushCodexAdapterWork();
  const transport = harness.transports.get(RUNTIME_ID);
  if (!transport) throw new Error("Expected the runtime transport.");
  const toolParts = (callId: string): AgentToolPart[] =>
    mutations
      .flatMap((mutation) => mutation.transcriptEvents)
      .flatMap((event: AgentEvent) =>
        event.type === "assistant_part" &&
        event.part.kind === "tool" &&
        event.part.callId === callId
          ? [event.part]
          : [],
      );
  const deniedActions = () =>
    harness.adapter.listLiveSessionSnapshots(RUNTIME_ID)[0]?.deniedActions ?? [];
  const methods = () => transport.calls.map(({ method }) => method);
  return { ...harness, stream, mutations, failures, transport, toolParts, deniedActions, methods };
};

describe("Codex auto-review denials", () => {
  test("marks the running call and its later emissions as denied, with an Allow entry", async () => {
    const { stream, failures, toolParts, deniedActions } = await setup();

    stream.emitNotification(startedCommand());
    stream.emitNotification(reviewNotification());
    await flushCodexAdapterWork();
    const denial = {
      source: "auto_review",
      reason: "Deletes the build output.",
      riskLevel: "high",
    };
    expect(toolParts("command-1").at(-1)).toMatchObject({ status: "running", denial });
    expect(deniedActions()).toEqual([{ callId: "command-1", state: "available" }]);

    stream.emitNotification(startedCommand("declined"));
    await flushCodexAdapterWork();
    expect(failures).toEqual([]);
    expect(toolParts("command-1").at(-1)).toMatchObject({ status: "error", denial });
  });

  test("shows a timed-out review without Allow", async () => {
    const { stream, toolParts, deniedActions } = await setup();

    stream.emitNotification(startedCommand());
    stream.emitNotification(reviewNotification({ status: "timedOut", rationale: null }));
    await flushCodexAdapterWork();

    expect(toolParts("command-1").at(-1)?.denial).toEqual({
      source: "auto_review_timeout",
      riskLevel: "high",
    });
    expect(deniedActions()).toEqual([]);
  });

  test("ignores reviews that did not deny the call", async () => {
    const { stream, toolParts, deniedActions } = await setup();

    stream.emitNotification(startedCommand());
    stream.emitNotification(reviewNotification({ status: "approved" }));
    await flushCodexAdapterWork();

    expect(toolParts("command-1").every((part) => part.denial === undefined)).toBe(true);
    expect(deniedActions()).toEqual([]);
  });

  test("adds its own row for a network review that names no tool item", async () => {
    const { stream, toolParts, deniedActions } = await setup();

    stream.emitNotification(
      reviewNotification({
        reviewId: "review-net",
        targetItemId: null,
        action: {
          type: "networkAccess",
          target: "https://x.dev",
          host: "x.dev",
          protocol: "https",
          port: 443,
        },
      }),
    );
    await flushCodexAdapterWork();

    expect(toolParts("auto-review:review-net")).toEqual([
      {
        kind: "tool",
        messageId: "auto-review:review-net",
        partId: "auto-review:review-net",
        callId: "auto-review:review-net",
        tool: "networkAccess",
        toolType: "generic",
        title: "Network access to x.dev",
        status: "error",
        input: { target: "https://x.dev", host: "x.dev", protocol: "https", port: 443 },
        startedAtMs: 1_000,
        endedAtMs: 2_000,
        denial: { source: "auto_review", reason: "Deletes the build output.", riskLevel: "high" },
      },
    ]);
    expect(deniedActions()).toEqual([{ callId: "auto-review:review-net", state: "available" }]);
  });

  test("forgets the Allow entries when the session stops", async () => {
    const { adapter, stream, deniedActions } = await setup();
    stream.emitNotification(reviewNotification());
    await flushCodexAdapterWork();
    expect(deniedActions()).toHaveLength(1);

    await adapter.stopSession(codexSessionRef(THREAD_ID));
    expect(adapter.listLiveSessionSnapshots(RUNTIME_ID)).toEqual([]);
    expect(
      adapter.claimDeniedAction({
        runtimeId: RUNTIME_ID,
        externalSessionId: THREAD_ID,
        callId: "command-1",
      }),
    ).toMatchObject({ kind: "unavailable" });
  });

  test("shows a permission request that the host rejects for the read-only role", async () => {
    const { adapter, stream, toolParts } = await setup();
    stream.emitServerRequest({
      id: 32,
      method: "item/permissions/requestApproval",
      params: {
        threadId: THREAD_ID,
        turnId: "turn-live",
        itemId: "call-perm",
        environmentId: null,
        startedAtMs: 1_000,
        cwd: "/repo",
        reason: "Needs network access.",
        permissions: { network: { enabled: true }, fileSystem: null },
      },
    });
    await flushCodexAdapterWork();
    const requestId =
      adapter.listLiveSessionSnapshots(RUNTIME_ID)[0]?.pendingApprovals[0]?.requestId;
    if (!requestId) throw new Error("Expected an approval request.");

    await adapter.replyLiveApproval({
      runtimeId: RUNTIME_ID,
      externalSessionId: THREAD_ID,
      requestId,
      outcome: "reject",
      message: "The planner role is read-only.",
      denialSource: "read_only_role",
    });
    await flushCodexAdapterWork();

    expect(toolParts("call-perm").at(-1)).toMatchObject({
      title: "Additional permissions",
      status: "error",
      input: { reason: "Needs network access." },
      denial: { source: "read_only_role", reason: "The planner role is read-only." },
    });
  });

  test("publishes a permission request row after the runtime event before it", async () => {
    const finish = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const stream = createRuntimeStreamSubscription();
    const mutations: CodexLiveSessionMutation[] = [];
    const { adapter } = createHarness({
      subscribeEvents: stream.subscribeEvents,
      onLiveSessionMutation: (mutation) => {
        mutations.push(mutation);
      },
      onRuntimeEventQueueFailure: () => {},
      prepareImageGenerations: async (images) => {
        started.resolve();
        await finish.promise;
        return images.map(({ item, context }) => codexImageGenerationPart(item, context, "rev"));
      },
    });
    await adapter.prepareRuntime(RUNTIME_ID);
    await adapter.startSession(codexStartSessionInput());
    stream.emitServerRequest({
      id: 33,
      method: "item/permissions/requestApproval",
      params: {
        threadId: THREAD_ID,
        turnId: "turn-live",
        itemId: "call-perm",
        environmentId: null,
        startedAtMs: 1_000,
        cwd: "/repo",
        reason: null,
        permissions: { network: { enabled: true }, fileSystem: null },
      },
    });
    await flushCodexAdapterWork();
    const requestId =
      adapter.listLiveSessionSnapshots(RUNTIME_ID)[0]?.pendingApprovals[0]?.requestId;
    if (!requestId) throw new Error("Expected an approval request.");
    stream.emitNotification({
      method: "item/completed",
      params: {
        threadId: THREAD_ID,
        turnId: "turn-live",
        completedAtMs: 1,
        item: {
          type: "imageGeneration",
          id: "image",
          status: "completed",
          result: "A".repeat(Math.ceil((32 * 1024 * 1024) / 3) * 4),
          revisedPrompt: null,
          failure: null,
        },
      },
    });
    await started.promise;

    await adapter.replyLiveApproval({
      runtimeId: RUNTIME_ID,
      externalSessionId: THREAD_ID,
      requestId,
      outcome: "reject",
      message: "The planner role is read-only.",
      denialSource: "read_only_role",
    });
    finish.resolve();
    await flushCodexAdapterWork();

    const partIds = mutations
      .flatMap((mutation) => mutation.transcriptEvents)
      .flatMap((event: AgentEvent) => (event.type === "assistant_part" ? [event.part.partId] : []));
    expect(partIds).toContain("image");
    expect(partIds.indexOf("call-perm")).toBeGreaterThan(partIds.indexOf("image"));
  });

  test("keeps no role denial when the reject reply fails before Codex gets it", async () => {
    let replies = 0;
    const { adapter, stream, toolParts } = await setup({
      respondServerRequest: async (_runtimeId, _requestId, _result, _error, onIssued) => {
        replies += 1;
        if (replies === 1) throw new Error("The Codex process closed its input.");
        onIssued?.();
      },
    });
    stream.emitServerRequest({
      id: 34,
      method: "item/fileChange/requestApproval",
      params: { itemId: "patch-2", startedAtMs: 1, threadId: THREAD_ID, turnId: "turn-live" },
    });
    await flushCodexAdapterWork();
    const requestId =
      adapter.listLiveSessionSnapshots(RUNTIME_ID)[0]?.pendingApprovals[0]?.requestId;
    if (!requestId) throw new Error("Expected an approval request.");
    const reply = {
      runtimeId: RUNTIME_ID,
      externalSessionId: THREAD_ID,
      requestId,
    } as const;

    await expect(
      adapter.replyLiveApproval({
        ...reply,
        outcome: "reject",
        message: "The planner role is read-only.",
        denialSource: "read_only_role",
      }),
    ).rejects.toThrow("closed its input");
    await adapter.replyLiveApproval({ ...reply, outcome: "approve_once" });
    stream.emitNotification({
      method: "item/completed",
      params: {
        threadId: THREAD_ID,
        turnId: "turn-live",
        completedAtMs: 2_000,
        item: { type: "fileChange", id: "patch-2", changes: [], status: "completed" },
      },
    });
    await flushCodexAdapterWork();

    expect(toolParts("patch-2").at(-1)).toMatchObject({ status: "completed" });
    expect(toolParts("patch-2").at(-1)?.denial).toBeUndefined();
  });

  test("marks a call that the host rejects for the read-only role", async () => {
    const { adapter, stream, toolParts } = await setup();
    stream.emitServerRequest({
      id: 31,
      method: "item/fileChange/requestApproval",
      params: { itemId: "patch-1", startedAtMs: 1, threadId: THREAD_ID, turnId: "turn-live" },
    });
    await flushCodexAdapterWork();
    const requestId =
      adapter.listLiveSessionSnapshots(RUNTIME_ID)[0]?.pendingApprovals[0]?.requestId;
    if (!requestId) throw new Error("Expected an approval request.");

    await adapter.replyLiveApproval({
      runtimeId: RUNTIME_ID,
      externalSessionId: THREAD_ID,
      requestId,
      outcome: "reject",
      message: "The planner role is read-only.",
      denialSource: "read_only_role",
    });
    stream.emitNotification({
      method: "item/completed",
      params: {
        threadId: THREAD_ID,
        turnId: "turn-live",
        completedAtMs: 2_000,
        item: { type: "fileChange", id: "patch-1", changes: [], status: "declined" },
      },
    });
    await flushCodexAdapterWork();

    expect(toolParts("patch-1").at(-1)?.denial).toEqual({
      source: "read_only_role",
      reason: "The planner role is read-only.",
    });
  });
});

describe("Codex denied action Allow", () => {
  const locator = { runtimeId: RUNTIME_ID, externalSessionId: THREAD_ID, callId: "command-1" };

  test("sends the denied review back to Codex and starts one turn on an idle thread", async () => {
    const { adapter, stream, transport, deniedActions, methods } = await setup();
    stream.emitNotification(reviewNotification());
    await flushCodexAdapterWork();
    const turnStartsBefore = methods().filter((method) => method === "turn/start").length;

    expect(adapter.claimDeniedAction(locator)).toEqual({ kind: "claimed" });
    expect(deniedActions()).toEqual([{ callId: "command-1", state: "sending" }]);
    expect(adapter.claimDeniedAction(locator)).toMatchObject({ kind: "unavailable" });
    await adapter.allowDeniedAction(locator);

    const approval = transport.calls.find(
      (call) => call.method === "thread/approveGuardianDeniedAction",
    );
    expect(approval?.params).toEqual({
      threadId: THREAD_ID,
      event: {
        id: "review-1",
        turn_id: "turn-live",
        started_at_ms: 1_000,
        completed_at_ms: 2_000,
        status: "denied",
        risk_level: "high",
        user_authorization: "low",
        rationale: "Deletes the build output.",
        decision_source: "agent",
        action: commandAction,
      },
    });
    const turnStarts = transport.calls.filter((call) => call.method === "turn/start");
    expect(turnStarts).toHaveLength(turnStartsBefore + 1);
    expect(turnStarts.at(-1)?.params).toMatchObject({ threadId: THREAD_ID, input: [] });
    expect(deniedActions()).toEqual([{ callId: "command-1", state: "allowed" }]);
    expect(adapter.claimDeniedAction(locator)).toEqual({
      kind: "unavailable",
      message: "This call is already allowed.",
    });
  });

  test("gives each execve review of one command its own row and Allow", async () => {
    const { adapter, stream, transport, toolParts, deniedActions } = await setup();
    const execve = (argv: string[]) => ({
      type: "execve",
      source: "shell",
      program: argv[0] ?? "",
      argv,
      cwd: "/repo",
    });
    stream.emitNotification(startedCommand());
    stream.emitNotification(
      reviewNotification({ reviewId: "review-a", action: execve(["rm", "-rf", "build"]) }),
    );
    stream.emitNotification(
      reviewNotification({ reviewId: "review-b", action: execve(["curl", "x.dev"]) }),
    );
    await flushCodexAdapterWork();

    // Codex declines the command too, so its row shows the denial, without an Allow of its own.
    stream.emitNotification(startedCommand("declined"));
    await flushCodexAdapterWork();
    expect(toolParts("command-1").at(-1)).toMatchObject({
      status: "error",
      denial: { source: "auto_review" },
    });
    expect(toolParts("auto-review:review-a").at(-1)).toMatchObject({
      title: "Program call rm -rf build",
      denial: { source: "auto_review" },
    });
    expect(deniedActions()).toEqual([
      { callId: "auto-review:review-a", state: "available" },
      { callId: "auto-review:review-b", state: "available" },
    ]);

    const first = { ...locator, callId: "auto-review:review-a" };
    expect(adapter.claimDeniedAction(first)).toEqual({ kind: "claimed" });
    await adapter.allowDeniedAction(first);

    const approval = transport.calls.find(
      (call) => call.method === "thread/approveGuardianDeniedAction",
    );
    expect(approval?.params).toMatchObject({ event: { id: "review-a" } });
    expect(deniedActions()).toEqual([
      { callId: "auto-review:review-a", state: "allowed" },
      { callId: "auto-review:review-b", state: "available" },
    ]);
  });

  test("starts no turn while a turn runs, because Codex adds the approval to it", async () => {
    const { adapter, stream, transport, methods } = await setup({ deferTurnStart: true });
    transport.turnStartDeferred.resolve({
      turn: codexTurnFixture({ id: "turn-live", items: [], status: "inProgress" }),
    });
    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: THREAD_ID,
        parts: [{ kind: "text", text: "Go" }],
      }),
    );
    stream.emitNotification(reviewNotification());
    await flushCodexAdapterWork();
    const turnStartsBefore = methods().filter((method) => method === "turn/start").length;

    adapter.claimDeniedAction(locator);
    await adapter.allowDeniedAction(locator);

    expect(methods()).toContain("thread/approveGuardianDeniedAction");
    expect(methods().filter((method) => method === "turn/start")).toHaveLength(turnStartsBefore);
  });

  test("offers Allow again with the reason when Codex refuses the approval", async () => {
    const { adapter, stream, transport, deniedActions, methods } = await setup();
    stream.emitNotification(reviewNotification());
    await flushCodexAdapterWork();
    transport.approveGuardianError = new Error("thread not loaded");
    const turnStartsBefore = methods().filter((method) => method === "turn/start").length;

    adapter.claimDeniedAction(locator);
    await expect(adapter.allowDeniedAction(locator)).rejects.toThrow("thread not loaded");

    expect(deniedActions()).toEqual([
      { callId: "command-1", state: "available", failure: "thread not loaded" },
    ]);
    expect(methods().filter((method) => method === "turn/start")).toHaveLength(turnStartsBefore);
  });

  test("keeps the approval when the follow-up turn fails", async () => {
    const { adapter, stream, transport, deniedActions } = await setup();
    stream.emitNotification(reviewNotification());
    await flushCodexAdapterWork();
    transport.beforeTurnStartAnswer = async () => {
      throw new Error("turn refused");
    };

    adapter.claimDeniedAction(locator);
    await expect(adapter.allowDeniedAction(locator)).rejects.toThrow(
      "Codex received the approval, but the agent did not continue",
    );

    expect(deniedActions()).toEqual([
      {
        callId: "command-1",
        state: "allowed",
        failure: expect.stringContaining("turn refused"),
      },
    ]);
  });

  /** Spawns an idle child thread and lets Codex deny a call in it. */
  const denyInIdleChild = async ({ adapter, stream }: Awaited<ReturnType<typeof setup>>) => {
    stream.emitNotification({
      method: "item/completed",
      params: {
        threadId: THREAD_ID,
        turnId: "spawn-turn",
        completedAtMs: 1,
        item: {
          type: "collabAgentToolCall",
          id: "spawn-child",
          tool: "spawnAgent",
          status: "completed",
          senderThreadId: THREAD_ID,
          receiverThreadIds: ["child"],
          prompt: "Clean the build",
          model: null,
          reasoningEffort: null,
          agentsStates: { child: { status: "completed", message: null } },
        },
      },
    });
    await flushCodexAdapterWork();
    stream.emitNotification({
      ...reviewNotification(),
      params: { ...reviewNotification().params, threadId: "child" },
    });
    await flushCodexAdapterWork();
    return adapter
      .listLiveSessionSnapshots(RUNTIME_ID)
      .find((snapshot) => snapshot.ref.externalSessionId === "child");
  };
  const childThread = z.object({ threadId: z.literal("child") });

  test("retains an idle child thread and starts its follow-up turn on the child", async () => {
    const context = await setup();
    const { adapter, transport } = context;
    const childLocator = { ...locator, externalSessionId: "child" };
    expect((await denyInIdleChild(context))?.deniedActions).toEqual([
      { callId: "command-1", state: "available" },
    ]);

    adapter.claimDeniedAction(childLocator);
    await adapter.allowDeniedAction(childLocator);

    const childCalls = transport.calls.filter((call) => childThread.safeParse(call.params).success);
    expect(childCalls.map(({ method }) => method)).toEqual([
      "thread/read",
      "thread/approveGuardianDeniedAction",
      "thread/resume",
      "turn/start",
    ]);
    expect(childCalls.at(-1)?.params).toMatchObject({ input: [] });
  });

  test("offers no Allow on a child thread that Codex keeps from direct input", async () => {
    const context = await setup();
    const { transport, toolParts } = context;
    const request = transport.request.bind(transport);
    transport.request = async (input) => {
      const result = await request(input);
      if (
        input.method !== "thread/read" ||
        !childThread.safeParse(input.params).success ||
        !("thread" in result)
      )
        return result;
      // A multi-agent v2 child, as `thread_enrichment.rs` reports it.
      return { ...result, thread: { ...result.thread, canAcceptDirectInput: false } };
    };

    const child = await denyInIdleChild(context);
    context.stream.emitNotification({
      ...startedCommand("declined"),
      params: { ...startedCommand("declined").params, threadId: "child" },
    });
    await flushCodexAdapterWork();

    expect(transport.calls.map(({ method }) => method)).toContain("thread/read");
    expect(child?.deniedActions).toBeUndefined();
    expect(toolParts("command-1").at(-1)).toMatchObject({
      status: "error",
      denial: { source: "auto_review", reason: "Deletes the build output." },
    });
  });

  test("shows a permission request denial on its own row without Allow", async () => {
    const { stream, toolParts, deniedActions } = await setup();
    stream.emitNotification(
      reviewNotification({
        reviewId: "review-perm",
        // Codex names the tool call, but it creates no tool item for a permission request.
        targetItemId: "call-perm",
        action: { type: "requestPermissions", reason: null, permissions: {} },
      }),
    );
    await flushCodexAdapterWork();

    expect(toolParts("auto-review:review-perm").at(-1)?.denial?.source).toBe("auto_review");
    expect(toolParts("call-perm")).toEqual([]);
    expect(deniedActions()).toEqual([]);
  });

  test("titles an execve review with the executed program and its arguments", async () => {
    const { stream, toolParts } = await setup();
    stream.emitNotification(
      reviewNotification({
        reviewId: "review-exec",
        action: {
          type: "execve",
          source: "shell",
          program: "/usr/bin/printf",
          argv: ["display-name", "hello world"],
          cwd: "/repo",
        },
      }),
    );
    await flushCodexAdapterWork();

    expect(toolParts("auto-review:review-exec").at(-1)?.title).toBe(
      "Program call /usr/bin/printf 'hello world'",
    );
  });
});

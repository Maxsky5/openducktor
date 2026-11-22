import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  RUNTIME_DESCRIPTORS_BY_KIND,
  HANDOFF_ATTEMPT_MISSING,
  agentChatHandoffResultSchema,
  type AgentChatHandoffSendInput,
  type AgentMessageTarget,
  type AgentSessionLiveEnvelope,
  type AgentSessionScope,
  type HandoffLink,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createTaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";
import { HostValidationError } from "../../effect/host-errors";
import { createRuntimeHandoffCommands } from "./runtime-handoff-command";
import { createSessionOperationOwner } from "./session-operation-owner";
import {
  AgentSessionAcceptanceUnknownError,
  AgentSessionMessageAcceptedError,
} from "../../ports/agent-session-send-error";
import { nativeHandoffAdmission } from "../../composition/node/native-handoff-admission";
import type { AgentSessionOperationPolicy } from "./agent-session-operation-policy";
import { SessionOperationError } from "../../ports/session-operation-error";

const timestamp = "2026-01-01T00:00:00.000Z";
const source = {
  repoPath: "/repo",
  workingDirectory: "/repo",
  runtimeKind: "codex",
  externalSessionId: "source",
} as const;
const target = { ...source, runtimeKind: "opencode", externalSessionId: "target" } as const;
const { repoPath, ...expectedActive } = source;
const input: AgentChatHandoffSendInput = {
  chat: { kind: "workspace_session", repoPath, workspaceId: "scope", sessionId: "chat" },
  expectedActive,
  destination: { runtimeKind: "opencode", providerId: "provider", modelId: "model" },
  submissionId: "first-handoff",
  parts: [{ kind: "text", text: "Continue the review." }],
};

const setup = ({
  failFirstCommit = false,
  unrecognizedReceipt = false,
  acceptedThenFailed = false,
  savedLinks = [],
  prepareSend = Effect.succeed("Review only."),
  scope = { kind: "repository", workspaceId: "scope" },
  withRootLock = (_target, work) => work,
}: {
  failFirstCommit?: boolean;
  unrecognizedReceipt?: boolean;
  acceptedThenFailed?: boolean;
  savedLinks?: HandoffLink[];
  prepareSend?: import("./runtime-handoff-command").RuntimeHandoffOwner["prepareSend"];
  scope?: AgentSessionScope;
  withRootLock?: ReturnType<typeof createSessionOperationOwner>["withRootLock"];
} = {}) => {
  const events: AgentSessionLiveEnvelope[] = [];
  const sent: Parameters<
    Parameters<typeof createRuntimeHandoffCommands>[0]["runtime"]["sendUserMessage"]
  >[0][] = [];
  const committed: Parameters<Parameters<typeof createRuntimeHandoffCommands>[0]["commit"]>[0][] =
    [];
  const live = {
    ref: source,
    title: "Review",
    activity: "idle" as const,
    startedAt: timestamp,
    pendingApprovals: [],
    pendingQuestions: [],
    contextUsage: null,
  };
  let commitAttempts = 0;
  const started: Parameters<
    Parameters<typeof createRuntimeHandoffCommands>[0]["creation"]["startSession"]
  >[0][] = [];
  const commands = createRuntimeHandoffCommands({
    worktreeReads: createTaskSessionLifecycleCoordinator(),
    runtime: {
      read: () => Effect.succeed({ type: "live", session: live }),
      list: () => Effect.succeed([live]),
      sendUserMessage: (request) =>
        Effect.gen(function* () {
          sent.push(request);
          const accepted = {
            type: "user_message",
            externalSessionId: target.externalSessionId,
            timestamp,
            messageId: unrecognizedReceipt
              ? "other-message"
              : (request.handoff?.admissionId ?? "unmatched"),
            message: "Continue the review.",
            parts: [{ kind: "text", text: "Continue the review." }],
            state: "read",
          } as const;
          const message = { ...accepted, parts: [...accepted.parts] };
          return acceptedThenFailed
            ? yield* new AgentSessionMessageAcceptedError(
                { sessionRef: target, acceptedMessage: message, stage: "live_update" },
                new Error("Destination projection failed"),
              )
            : message;
        }),
      releaseSession: () => Effect.void,
      publishOperation: (event) =>
        Effect.sync(() => {
          events.push(event);
        }),
      retainOperation: () => Effect.void,
    },
    queries: {
      loadRuntimeCatalog: () =>
        Effect.succeed({
          runtime: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
          models: {
            status: "available",
            catalog: {
              defaultModelsByProvider: {},
              models: [
                {
                  id: "model",
                  providerId: "provider",
                  providerName: "Provider",
                  modelId: "model",
                  modelName: "Model",
                  variants: ["balanced"],
                  contextWindow: 64_000,
                },
              ],
            },
          },
        }),
    },
    readHistory: () =>
      Effect.succeed([
        {
          role: "user",
          state: "read",
          messageId: "original",
          timestamp,
          text: "Review src/app.ts.",
          displayParts: [],
          parts: [],
        },
        {
          role: "assistant",
          messageId: "first-response",
          timestamp,
          text: "I found the affected test.",
          parts: [
            {
              kind: "reasoning",
              messageId: "first-response",
              partId: "thinking",
              text: "private reasoning",
              completed: true,
            },
          ],
        },
        {
          role: "system",
          messageId: "runtime-error",
          timestamp,
          text: "The workspace could not be opened.",
          parts: [],
          notice: { tone: "error", reason: "session_error", title: "Error" },
        },
      ]),
    creation: {
      startSession: (request) =>
        Effect.sync(() => {
          started.push(request);
          return {
            ...target,
            startedAt: timestamp,
            title: "Review",
            status: "idle",
            sessionAssociation: scope,
          };
        }),
    },
    resolveOwner: () =>
      Effect.succeed({
        scope,
        prepareSend,
        requireWritable: Effect.void,
        active: savedLinks.at(-1)?.to ?? expectedActive,
        links: savedLinks,
      }),
    withRootLock,
    requireDestinationAdmission: () => Effect.void,
    policyFor: () => ({ run: (_ref, _operation, effect) => effect }),
    resolveParts: Effect.succeed,
    ensureNoScheduledWork: () => Effect.void,
    checkActiveMember: () => Effect.void,
    readDestinationBudget: () => Effect.succeed({ contextWindow: 64_000, usedTokens: 0 }),
    readStagedHistory: () => {
      const messageId = sent[0]?.handoff?.admissionId;
      return Effect.succeed(
        unrecognizedReceipt && messageId
          ? [
              {
                role: "user",
                state: "read",
                messageId,
                timestamp,
                text: "Continue the review.",
                displayParts: [],
                parts: [],
              },
            ]
          : [],
      );
    },
    readPrefix: () => Effect.succeed(null),
    commit: (value) =>
      Effect.suspend(() => {
        if (++commitAttempts === 1 && failFirstCommit) {
          return Effect.fail(new HostValidationError({ message: "Test write failure" }));
        }
        return Effect.sync(() => {
          committed.push(value);
        });
      }),
    publishOwner: () => Effect.void,
    digestPrefix: (bytes) => createHash("sha256").update(bytes).digest("hex"),
    admission: nativeHandoffAdmission,
  });
  return { commands, sent, committed, started, events };
};

test("sends an attributed history and original draft exactly once to the selected runtime", async () => {
  const { commands, sent, committed, started } = setup();
  try {
    const result = await Effect.runPromise(commands.send(input));
    expect(result.handoff.committed).toBe(true);
    expect(await Effect.runPromise(commands.send(input))).toEqual(result);
    expect(sent).toHaveLength(1);
    expect(started[0]?.model).toEqual({ ...input.destination, variant: "balanced" });
    expect(committed[0]?.model).toEqual({ ...input.destination, variant: "balanced" });
    expect(sent[0]).toMatchObject({ ...target, parts: input.parts, systemPrompt: "Review only." });
    expect(sent[0]?.handoff?.historyPrefix).toContain('User: "Review src/app.ts."');
    expect(sent[0]?.handoff?.historyPrefix).toContain('Assistant: "I found the affected test."');
    expect(sent[0]?.handoff?.historyPrefix).toContain(
      'Activity: "The workspace could not be opened."',
    );
    expect(sent[0]?.handoff?.historyPrefix).not.toContain("private reasoning");
    expect(committed[0]?.link.firstMessageId).toBe(sent[0]?.handoff?.admissionId);
  } finally {
    await Effect.runPromise(commands.shutdown());
  }
});

test("Check repairs a failed ownership save without hiding a failure after native acceptance", async () => {
  let admitted = true;
  const scope = { kind: "workflow", workspaceId: "scope", taskId: "task-1", role: "qa" } as const;
  const taskInput = {
    ...input,
    chat: {
      kind: "task_session",
      repoPath,
      workspaceId: scope.workspaceId,
      taskId: scope.taskId,
      role: scope.role,
      first: expectedActive,
    },
  } satisfies AgentChatHandoffSendInput;
  const { commands, sent, committed, events } = setup({
    scope,
    failFirstCommit: true,
    acceptedThenFailed: true,
    prepareSend: Effect.suspend(() =>
      admitted
        ? Effect.succeed("Review only.")
        : Effect.fail(
            new HostValidationError({ message: "This task can no longer start a QA turn." }),
          ),
    ),
  });
  try {
    const result = await Effect.runPromise(commands.send(taskInput));
    expect(result.nativeOutcome).toBe("accepted");
    expect(result.handoff.committed).toBeUndefined();
    expect(result.failure?.stage).toBe("save");
    expect(result.failure?.message).toContain("Destination projection failed");
    expect(commands.hasUnresolvedWorkspaceHandoff(scope.workspaceId)).toBe(true);
    expect(commands.hasUnresolvedWorkspaceHandoff("another")).toBe(false);
    expect(commands.hasUnresolvedTaskHandoff(scope)).toBe(true);
    expect(commands.hasUnresolvedTaskHandoff({ ...scope, workspaceId: "another" })).toBe(false);
    expect(commands.hasUnresolvedTaskHandoff({ ...scope, taskId: "another" })).toBe(false);
    expect(commands.acceptedDestination(target, scope)).toMatchObject({
      firstMessageId: result.handoff.acceptedLink?.firstMessageId,
      receipt: { version: 1 },
    });
    expect(commands.acceptedDestination(target, { ...scope, workspaceId: "another" })).toBeNull();
    expect(events).toContainEqual({
      type: "session_operation_updated",
      observation: expect.objectContaining({
        nativeOutcome: "accepted",
        pending: false,
        handoff: expect.objectContaining({ acceptedLink: result.handoff.acceptedLink }),
      }),
    });
    const blocked = await Effect.runPromise(
      Effect.result(
        commands.guardWork({
          ...source,
          sessionScope: scope,
        }),
      ),
    );
    expect(blocked._tag).toBe("Failure");
    admitted = false;
    const repaired = await Effect.runPromise(commands.check(taskInput));
    expect(repaired.handoff.committed).toBe(true);
    expect(commands.hasUnresolvedTaskHandoff(scope)).toBe(false);
    expect(commands.hasUnresolvedWorkspaceHandoff(scope.workspaceId)).toBe(false);
    expect(repaired.failure).toMatchObject({
      stage: "live_update",
      code: "agent_session_message_accepted",
      message: expect.stringContaining("Destination projection failed"),
    });
    expect(events).toContainEqual({
      type: "session_operation_updated",
      observation: expect.objectContaining({ failure: repaired.failure }),
    });
    expect(sent).toHaveLength(1);
    expect(committed).toHaveLength(1);
  } finally {
    await Effect.runPromise(commands.shutdown());
  }
});

test("a replacement host checks the committed message ID without resending", async () => {
  const first = setup();
  let link: HandoffLink | undefined;
  try {
    link = (await Effect.runPromise(first.commands.send(input))).handoff.acceptedLink;
  } finally {
    await Effect.runPromise(first.commands.shutdown());
  }
  if (!link) throw new Error("Expected the saved handoff link");
  const replacement = setup({
    savedLinks: [link],
    prepareSend: Effect.fail(new HostValidationError({ message: "The QA role is unavailable." })),
  });
  try {
    const proof = { chat: input.chat, submissionId: input.submissionId };
    const checked = agentChatHandoffResultSchema.parse(
      await Effect.runPromise(replacement.commands.check(proof)),
    );
    expect(checked.handoff).toMatchObject({ committed: true, acceptedLink: link });
    expect(checked.handoff.destination).toBeUndefined();
    const withHint = await Effect.runPromise(
      replacement.commands.check({
        ...proof,
        destination: { runtimeKind: "claude", providerId: "anthropic", modelId: "different" },
      }),
    );
    expect(withHint).toEqual(checked);
    const unrelated = await Effect.runPromise(
      Effect.result(replacement.commands.check({ ...input, submissionId: "another-attempt" })),
    );
    expect(unrelated._tag).toBe("Failure");
    expect(replacement.sent).toHaveLength(0);
  } finally {
    await Effect.runPromise(replacement.commands.shutdown());
  }
});

test("Check keeps delivery unconfirmed while Send waits for the source lock", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const { commands, sent } = setup({
    withRootLock: (_source, work) =>
      Effect.promise(() => {
        entered.resolve();
        return release.promise;
      }).pipe(Effect.andThen(work)),
  });
  const sending = Effect.runPromise(commands.send(input));
  try {
    await entered.promise;
    const unknown = await Effect.runPromise(Effect.flip(commands.check(input)));
    expect(unknown).toBeInstanceOf(SessionOperationError);
    expect(unknown).toMatchObject({
      observation: {
        submissionId: input.submissionId,
        nativeOutcome: "uncertain",
        failure: { code: HANDOFF_ATTEMPT_MISSING },
      },
    });
  } finally {
    release.resolve();
    try {
      expect((await sending).handoff.committed).toBe(true);
      expect(sent).toHaveLength(1);
    } finally {
      await Effect.runPromise(commands.shutdown());
    }
  }
});

test("does not start a destination while the source has uncertain native delivery", async () => {
  const root: AgentMessageTarget = {
    ...source,
    sessionScope: { kind: "repository", workspaceId: input.chat.workspaceId },
  };
  const unexpected = () => Effect.die("Unexpected command preparation");
  const policy: AgentSessionOperationPolicy = {
    run: (_target, _operation, work) => work,
    runSend: (_target, work) => work,
    validateRef: unexpected,
    prepareForkSource: unexpected,
    prepareDelivery: unexpected,
    prepareSend: unexpected,
    prepareResume: unexpected,
    prepareModelUpdate: unexpected,
    recordAcceptedMessage: unexpected,
  };
  const owner = createSessionOperationOwner({
    resolveRoot: () => Effect.succeed(root),
    policyFor: () => policy,
    publish: () => Effect.void,
    retain: () => Effect.void,
  });
  const { commands, started } = setup({ withRootLock: owner.withRootLock });
  try {
    await Effect.runPromise(
      Effect.result(
        owner.run(
          root,
          "submission",
          Effect.gen(function* () {
            const options = yield* owner.options();
            options.onSent();
            return yield* new AgentSessionAcceptanceUnknownError({
              message: "The source accepted the request connection but its reply was lost.",
              messageId: "source-message",
              cause: new Error("Lost reply"),
            });
          }),
          "source-submission",
        ),
      ),
    );
    const blocked = await Effect.runPromise(commands.send(input));
    expect(blocked.nativeOutcome).toBe("not_issued");
    expect(blocked.failure?.message).toContain("earlier operation with uncertain acceptance");
    expect(started).toHaveLength(0);
  } finally {
    await Effect.runPromise(commands.shutdown());
    await Effect.runPromise(owner.shutdown());
  }
});

test("keeps an unrecognized receipt uncertain until native history confirms the same submission", async () => {
  const { commands, sent, committed } = setup({ unrecognizedReceipt: true });
  try {
    const result = await Effect.runPromise(commands.send(input));
    expect(result.nativeOutcome).toBe("uncertain");
    expect(committed).toHaveLength(0);
    const checked = await Effect.runPromise(commands.check(input));
    expect(checked.handoff.committed).toBe(true);
    expect(committed[0]?.link.firstMessageId).toBe(sent[0]?.handoff?.admissionId);
    expect(sent).toHaveLength(1);
  } finally {
    await Effect.runPromise(commands.shutdown());
  }
});

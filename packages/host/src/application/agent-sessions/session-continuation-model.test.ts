import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  agentModelCatalogSchema,
  agentSessionResumeIntentSchema,
  repoConfigSchema,
  settingsSnapshotSchema,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type AgentSessionLiveSnapshot,
  type AgentSessionModelSelection,
} from "@openducktor/contracts";
import type { AgentSessionControlContinueInterruptedTurnInput } from "../../ports/agent-session-live-adapter-port";
import { task } from "../tasks/test-support/task-workflow-harness";
import { createTaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";
import { createAgentSessionCommandService } from "./agent-session-command-service";
import { createSessionTurnPreparation } from "./session-turn-preparation";

const root = {
  repoPath: "/repo",
  runtimeKind: "codex" as const,
  workingDirectory: "/repo/tree",
  externalSessionId: "root",
  sessionScope: { kind: "workflow" as const, taskId: "task-1", role: "build" as const },
};
const selection = (modelId: string): AgentSessionModelSelection => ({
  runtimeKind: "codex",
  providerId: "openai",
  modelId,
});
const setup = (
  evidence: "available" | "missing snapshot" | "missing model" | "removed model" = "available",
) => {
  const unexpected = () => Effect.die(new Error("Unexpected native or stored change"));
  const continuations: AgentSessionControlContinueInterruptedTurnInput[] = [];
  const snapshots = ["root", "child"].map((id): AgentSessionLiveSnapshot => {
    const snapshot: AgentSessionLiveSnapshot = {
      ref: { ...root, externalSessionId: id },
      title: id,
      startedAt: "2026-10-14T10:00:00Z",
      activity: "idle",
      pendingApprovals: [],
      pendingQuestions: [],
      contextUsage: null,
    };
    if (id === "child") snapshot.parentExternalSessionId = "root";
    if (id !== "child" || evidence !== "missing model")
      snapshot.model = { providerId: "openai", modelId: `${id}-model` };
    return snapshot;
  });
  const taskReader = { getTask: () => Effect.succeed(task({ status: "in_progress" })) };
  const commands = createAgentSessionCommandService({
    canonicalizeRepoPath: Effect.succeed,
    taskReader,
    taskLifecycle: createTaskSessionLifecycleCoordinator(),
    taskSessionStart: { prepare: unexpected, complete: unexpected },
    persistTaskModel: unexpected,
    pauseForStop: () => Effect.void,
    approvalPolicy: { reply: unexpected },
    readSessionRootRefs: () => Effect.succeed([root]),
    turnPreparation: createSessionTurnPreparation({
      taskReader,
      settings: {
        getRepoConfigByRepoPath: () =>
          Effect.succeed(
            repoConfigSchema.parse({
              workspaceId: "workspace",
              workspaceName: "Workspace",
              repoPath: "/repo",
            }),
          ),
        getSettingsSnapshot: () =>
          Effect.succeed(settingsSnapshotSchema.parse({ theme: "system" })),
      },
      queries: {
        loadRuntimeCatalog: () =>
          Effect.succeed({
            models: {
              status: "available" as const,
              catalog: agentModelCatalogSchema.parse({
                runtime: RUNTIME_DESCRIPTORS_BY_KIND.codex,
                models: [
                  "root-model",
                  ...(evidence === "removed model" ? [] : ["child-model"]),
                ].map((modelId) => ({
                  id: `openai/${modelId}`,
                  providerId: "openai",
                  providerName: "OpenAI",
                  modelId,
                  modelName: modelId,
                  variants: [],
                })),
                defaultModelsByProvider: { openai: "root-model" },
                profiles: [],
              }),
            },
          }),
      },
    }),
    runtime: {
      list: () => Effect.succeed(snapshots),
      read: (ref) =>
        Effect.succeed(
          ref.externalSessionId === "child" && evidence === "missing snapshot"
            ? { type: "missing" as const, ref }
            : {
                type: "live" as const,
                session: snapshots.find((s) => s.ref.externalSessionId === ref.externalSessionId)!,
              },
        ),
      publishOperation: () => Effect.void,
      retainOperation: () => Effect.void,
      startSession: unexpected,
      forkSession: unexpected,
      resumeSession: unexpected,
      continueInterruptedTurn: (input) =>
        Effect.sync(() => {
          continuations.push(input);
          return {
            ...root,
            externalSessionId: input.externalSessionId,
            startedAt: "2026-10-14T10:00:00Z",
            status: "running" as const,
          };
        }),
      releaseSession: unexpected,
      stopSession: unexpected,
      sendUserMessage: unexpected,
      loadContext: unexpected,
      loadSessionDiff: unexpected,
      replyApproval: unexpected,
      replyQuestion: unexpected,
      updateSessionModel: unexpected,
    },
    tasks: {
      agentSessionsList: () =>
        Effect.succeed([
          {
            externalSessionId: "root",
            runtimeKind: "codex",
            workingDirectory: "/repo/tree",
            role: "build",
            selectedModel: selection("root-model"),
            startedAt: "2026-10-14T10:00:00Z",
          },
        ]),
      agentSessionUpsert: unexpected,
      agentSessionUpdateModel: unexpected,
      transitionTask: unexpected,
    },
    repositoryPolicy: {
      run: (_ref, _op, work) => work,
      runSend: (_ref, work) => work,
      prepareSend: unexpected,
      prepareResume: unexpected,
      prepareModelUpdate: unexpected,
      recordAcceptedMessage: unexpected,
      validateRef: unexpected,
    },
  });
  return { commands, continuations };
};

describe("host continuation model ownership", () => {
  test.each(["root", "child"])(
    "continues %s with its authoritative model without changing a saved choice",
    async (externalSessionId) => {
      const h = setup();
      try {
        const result = await Effect.runPromise(
          h.commands.resumeSession(
            agentSessionResumeIntentSchema.parse({
              ...root,
              externalSessionId,
              resumeMode: "continue_interrupted_turn",
            }),
          ),
        );
        expect(result.externalSessionId).toBe(externalSessionId);
        expect(h.continuations).toHaveLength(1);
        expect(h.continuations[0]).toMatchObject({
          externalSessionId,
          model: selection(`${externalSessionId}-model`),
        });
      } finally {
        await Effect.runPromise(h.commands.shutdownOperations());
      }
    },
  );

  test.each(["missing snapshot", "missing model", "removed model"] as const)(
    "rejects child continuation with %s before native work",
    async (evidence) => {
      const h = setup(evidence);
      try {
        const result = await Effect.runPromise(
          Effect.result(
            h.commands.resumeSession(
              agentSessionResumeIntentSchema.parse({
                ...root,
                externalSessionId: "child",
                resumeMode: "continue_interrupted_turn",
              }),
            ),
          ),
        );
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { message: expect.stringMatching(/model/i) },
        });
        expect(h.continuations).toEqual([]);
      } finally {
        await Effect.runPromise(h.commands.shutdownOperations());
      }
    },
  );
});

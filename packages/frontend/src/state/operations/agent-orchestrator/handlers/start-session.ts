import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import { createRepoStaleGuard, throwIfRepoStale } from "../support/core";
import { requireWorkspaceRepoPath } from "../support/session-invariants";
import {
  createExecutePreparedSessionLaunch,
  type PreparedSessionLaunchResult,
} from "./session-launch-executor";
import type {
  StartAgentSessionInput,
  StartAgentSessionResult,
  StartSessionContext,
  StartSessionDependencies,
} from "./start-session.types";
import { STALE_START_ERROR } from "./start-session-constants";
import { executeReuseStart } from "./start-session-reuse-strategy";
import { resolveStartTask } from "./start-session-policies";
import { stopStoredWorkflowSessionAfterLaunchFailure } from "./start-session-rollback";
import { serializeSelectedModelKey } from "./start-session-runtime";
import {
  registerWorkflowSessionLaunch,
  prepareWorkflowForkLaunch,
  prepareWorkflowFreshLaunch,
} from "./start-session-workflow-launch";

export type {
  StartAgentSessionInput,
  StartAgentSessionResult,
  StartSessionDependencies,
} from "./start-session.types";

const resolveFreshStartTarget = ({ input }: { input: StartAgentSessionInput }) => {
  if (input.startMode !== "fresh") {
    return null;
  }

  return {
    targetWorkingDirectory: input.targetWorkingDirectory,
    normalizedTargetWorkingDirectory: normalizeWorkingDirectory(input.targetWorkingDirectory),
  };
};

export const createStartAgentSession = ({
  repo,
  session,
  runtime,
  task,
  model,
}: StartSessionDependencies) => {
  const executePreparedLaunch = createExecutePreparedSessionLaunch({
    adapter: runtime.adapter,
    startWorkflowSession: runtime.startWorkflowSession,
    loadSettingsSnapshot: model.loadSettingsSnapshot,
    repoEpochRef: repo.repoEpochRef,
    currentWorkspaceRepoPathRef: repo.currentWorkspaceRepoPathRef,
  });
  return async (input: StartAgentSessionInput): Promise<StartAgentSessionResult> => {
    const { taskId, role, startMode } = input;
    const repoPath = requireWorkspaceRepoPath(repo.workspaceRepoPath);
    const workspaceId = repo.workspaceId?.trim();
    if (!workspaceId) {
      throw new Error("Active workspace is required.");
    }
    const isStaleRepoOperation = createRepoStaleGuard({
      repoPath,
      repoEpochRef: repo.repoEpochRef,
      currentWorkspaceRepoPathRef: repo.currentWorkspaceRepoPathRef,
    });
    throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);

    const startCtx: StartSessionContext = {
      repoPath,
      workspaceId,
      taskId,
      role,
      holdForPostStartMessage:
        input.startMode !== "reuse" && input.holdForPostStartMessage === true,
      isStaleRepoOperation,
    };

    if (input.startMode === "fresh" && role === "qa") {
      resolveStartTask({ ctx: startCtx, task });
    }

    const sourceSessionKey =
      input.startMode === "fresh" ? "" : agentSessionIdentityKey(input.sourceSession);
    const freshStartTarget = resolveFreshStartTarget({
      input,
    });
    const normalizedTargetWorkingDirectory =
      freshStartTarget?.normalizedTargetWorkingDirectory ?? "";
    const selectedModelKey =
      input.startMode === "reuse" ? "" : serializeSelectedModelKey(input.selectedModel);
    const messagePolicyKey = startCtx.holdForPostStartMessage
      ? "post-start-message"
      : "no-post-start-message";
    const gateMode = input.startMode === "fresh" && input.queueIfBusy ? "queue" : "coalesce";
    const inFlightKey = [
      repoPath,
      taskId,
      role,
      startMode,
      sourceSessionKey,
      normalizedTargetWorkingDirectory,
      selectedModelKey,
      messagePolicyKey,
    ].join("::");
    const executionKey = input.startMode === "reuse" ? inFlightKey : [repoPath, taskId].join("::");

    return session.sessionStartGateRef.current.run(
      inFlightKey,
      async () => {
        const deps = {
          session,
          runtime,
          task,
          model,
        };
        if (input.startMode === "reuse") {
          return executeReuseStart({ ctx: startCtx, input, deps });
        }

        const prepared =
          input.startMode === "fork"
            ? await prepareWorkflowForkLaunch({ ctx: startCtx, input, deps })
            : await prepareWorkflowFreshLaunch({
                ctx: startCtx,
                input,
                targetWorkingDirectory: freshStartTarget?.targetWorkingDirectory,
                deps,
              });

        const result: PreparedSessionLaunchResult = await executePreparedLaunch({
          launch: prepared.launch,
          register: async (registrationInput) => {
            await registerWorkflowSessionLaunch({
              ...registrationInput,
              ctx: startCtx,
              deps: { session, runtime, task },
            });
          },
          rollback: async (rollbackInput) =>
            stopStoredWorkflowSessionAfterLaunchFailure({
              message: rollbackInput.message,
              cause: rollbackInput.cause,
              startedCtx: { ...startCtx, summary: rollbackInput.summary },
              identity: rollbackInput.identity,
              readSessionSnapshot: session.readSessionSnapshot,
              replaceSession: session.replaceSession,
              clearSessionObservationState: session.clearSessionObservationState,
              runtime,
              stopReason: rollbackInput.stopReason,
            }),
        });
        return toAgentSessionIdentity(result.summary);
      },
      gateMode,
      executionKey,
    );
  };
};

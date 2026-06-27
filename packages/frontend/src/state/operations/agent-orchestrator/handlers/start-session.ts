import type { AgentSessionRuntimeRef } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { createRepoStaleGuard, throwIfRepoStale } from "../support/core";
import { requireWorkspaceRepoPath } from "../support/session-invariants";
import type {
  RuntimeDependencies,
  SessionDependencies,
  StartAgentSessionInput,
  StartAgentSessionResult,
  StartOrReuseResult,
  StartSessionContext,
  StartSessionDependencies,
} from "./start-session.types";
import { STALE_START_ERROR } from "./start-session-constants";
import { executeForkStart } from "./start-session-fork-strategy";
import { executeFreshStart } from "./start-session-fresh-strategy";
import { resolveStartTask } from "./start-session-policies";
import { executeReuseStart } from "./start-session-reuse-strategy";
import { stopSessionOnStaleAndThrow } from "./start-session-rollback";
import {
  resolveFreshStartTargetWorkingDirectoryForStart,
  serializeSelectedModelKey,
} from "./start-session-runtime";

export type {
  StartAgentSessionInput,
  StartAgentSessionResult,
  StartSessionDependencies,
} from "./start-session.types";

const resolveFreshStartTarget = async ({
  input,
  ctx,
  runtime,
}: {
  input: StartAgentSessionInput;
  ctx: StartSessionContext;
  runtime: RuntimeDependencies;
}) => {
  if (input.startMode !== "fresh") {
    return null;
  }

  return resolveFreshStartTargetWorkingDirectoryForStart({
    ctx,
    runtime,
    ...(input.targetWorkingDirectory !== undefined
      ? { targetWorkingDirectory: input.targetWorkingDirectory }
      : {}),
  });
};

const observeAgentSessionAndGuard = async ({
  startResult,
  session,
  runtime,
}: {
  startResult: Extract<StartOrReuseResult, { kind: "started" }>;
  session: SessionDependencies;
  runtime: RuntimeDependencies;
}): Promise<void> => {
  const { ctx: startedCtx, runtimeInfo } = startResult;
  const observerTarget: AgentSessionRuntimeRef = {
    externalSessionId: startedCtx.summary.externalSessionId,
    repoPath: startedCtx.repoPath,
    runtimeKind: runtimeInfo.runtimeKind,
    workingDirectory: runtimeInfo.workingDirectory,
    taskId: startedCtx.taskId,
    role: startedCtx.role,
  };

  await session.observeAgentSession(observerTarget);

  if (!startedCtx.isStaleRepoOperation()) {
    return;
  }

  await stopSessionOnStaleAndThrow({
    reason: "start-session-stop-on-stale-after-observer-start",
    runtime,
    startedCtx,
  });
};

export const createStartAgentSession = ({
  repo,
  session,
  runtime,
  task,
  model,
}: StartSessionDependencies) => {
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
    const freshStartTarget = await resolveFreshStartTarget({
      input,
      ctx: startCtx,
      runtime,
    });
    const normalizedTargetWorkingDirectory =
      freshStartTarget?.normalizedTargetWorkingDirectory ?? "";
    const selectedModelKey =
      input.startMode === "reuse" ? "" : serializeSelectedModelKey(input.selectedModel);
    const messagePolicyKey = startCtx.holdForPostStartMessage
      ? "post-start-message"
      : "no-post-start-message";
    const inFlightKeyParts = [
      repoPath,
      taskId,
      role,
      startMode,
      sourceSessionKey,
      normalizedTargetWorkingDirectory,
      selectedModelKey,
      messagePolicyKey,
    ];
    const inFlightKey = inFlightKeyParts.join("::");

    return session.sessionStartGateRef.current.run(inFlightKey, async () => {
      const deps = {
        session,
        runtime,
        task,
        model,
      };
      let startResult: StartOrReuseResult;
      if (input.startMode === "reuse") {
        startResult = await executeReuseStart({ ctx: startCtx, input, deps });
      } else if (input.startMode === "fork") {
        startResult = await executeForkStart({ ctx: startCtx, input, deps });
      } else {
        startResult = await executeFreshStart({
          ctx: startCtx,
          input,
          targetWorkingDirectory: freshStartTarget?.targetWorkingDirectory,
          deps,
        });
      }
      if (startResult.kind === "reused") {
        return startResult.session;
      }

      await observeAgentSessionAndGuard({
        startResult,
        session,
        runtime,
      });

      return {
        externalSessionId: startResult.ctx.summary.externalSessionId,
        runtimeKind: startResult.runtimeInfo.runtimeKind,
        workingDirectory: startResult.runtimeInfo.workingDirectory,
      };
    });
  };
};

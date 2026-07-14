import type { PolicyBoundSessionRef } from "@openducktor/core";
import { toAgentRuntimePolicyBinding } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import { createRepoStaleGuard, throwIfRepoStale } from "../support/core";
import { requireWorkspaceRepoPath } from "../support/session-invariants";
import type {
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
import { rollbackRegisteredStartedSession } from "./start-session-rollback";
import { serializeSelectedModelKey } from "./start-session-runtime";

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

const observeAgentSessionAndGuard = async ({
  startResult,
  session,
}: {
  startResult: Extract<StartOrReuseResult, { kind: "started" }>;
  session: SessionDependencies;
}): Promise<void> => {
  const { ctx: startedCtx, runtimeInfo } = startResult;
  const observerTarget: PolicyBoundSessionRef = {
    externalSessionId: startedCtx.summary.externalSessionId,
    repoPath: startedCtx.repoPath,
    ...toAgentRuntimePolicyBinding({
      runtimeKind: runtimeInfo.runtimeKind,
      runtimePolicy: startResult.runtimePolicy,
    }),
    workingDirectory: runtimeInfo.workingDirectory,
  };

  await session.observeAgentSession(observerTarget);

  if (!startedCtx.isStaleRepoOperation()) {
    return;
  }
  throw new Error(STALE_START_ERROR);
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

      let freshBuilderBootstrapCommitted = false;
      try {
        await observeAgentSessionAndGuard({
          startResult,
          session,
        });
        await startResult.runtimeInfo.bootstrap?.complete();
        freshBuilderBootstrapCommitted =
          input.startMode === "fresh" && role === "build" && !!startResult.runtimeInfo.bootstrap;
        if (startResult.ctx.isStaleRepoOperation()) {
          throw new Error(STALE_START_ERROR);
        }
      } catch (cause) {
        if (freshBuilderBootstrapCommitted) {
          throw cause;
        }
        const identity = {
          externalSessionId: startResult.ctx.summary.externalSessionId,
          runtimeKind: startResult.runtimeInfo.runtimeKind,
          workingDirectory: startResult.runtimeInfo.workingDirectory,
        };
        await rollbackRegisteredStartedSession({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
          startedCtx: startResult.ctx,
          identity,
          session,
          runtime,
          stopReason: "start-session-stop-after-observer-or-bootstrap-failure",
          ...(startResult.runtimeInfo.bootstrap
            ? { bootstrap: startResult.runtimeInfo.bootstrap }
            : {}),
        });
      }

      return {
        externalSessionId: startResult.ctx.summary.externalSessionId,
        runtimeKind: startResult.runtimeInfo.runtimeKind,
        workingDirectory: startResult.runtimeInfo.workingDirectory,
      };
    });
  };
};

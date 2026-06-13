import type { AgentSessionRef } from "@openducktor/core";
import type { InitialSessionStatusReleasePolicy } from "@/types/agent-orchestrator";
import { requireActiveRepo } from "../../tasks/task-operations-model";
import { requireConfiguredRuntimeKind } from "../runtime/runtime";
import { createRepoStaleGuard, throwIfRepoStale } from "../support/core";
import { requireSelectedModelRuntimeKindForStart } from "../support/session-runtime-metadata";
import type {
  RuntimeDependencies,
  SessionDependencies,
  StartAgentSessionInput,
  StartOrReuseResult,
  StartSessionContext,
  StartSessionCreationInput,
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
  StartSessionDependencies,
} from "./start-session.types";

const createOrReuseSession = async ({
  ctx,
  input,
  deps,
}: {
  ctx: StartSessionContext;
  input: StartSessionCreationInput;
  deps: Pick<StartSessionDependencies, "session" | "runtime" | "task" | "model">;
}): Promise<StartOrReuseResult> => {
  if (input.startMode === "reuse") {
    return executeReuseStart({ ctx, input, deps });
  }

  if (input.startMode === "fork") {
    return executeForkStart({ ctx, input, deps });
  }

  return executeFreshStart({ ctx, input, deps });
};

const toSessionCreationInput = ({
  input,
  targetWorkingDirectoryOverride,
}: {
  input: StartAgentSessionInput;
  targetWorkingDirectoryOverride?: { value: string | null };
}): StartSessionCreationInput => {
  if (input.startMode === "reuse") {
    return {
      startMode: "reuse",
      sourceExternalSessionId: input.sourceExternalSessionId,
    };
  }

  if (input.startMode === "fork") {
    return {
      startMode: "fork",
      selectedModel: input.selectedModel,
      sourceExternalSessionId: input.sourceExternalSessionId,
    };
  }

  const freshInput: StartSessionCreationInput = {
    startMode: "fresh",
    selectedModel: input.selectedModel,
  };

  if (targetWorkingDirectoryOverride) {
    freshInput.targetWorkingDirectory = targetWorkingDirectoryOverride.value;
    return freshInput;
  }

  if ("targetWorkingDirectory" in input) {
    freshInput.targetWorkingDirectory = input.targetWorkingDirectory;
  }

  return freshInput;
};

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

  if (!("targetWorkingDirectory" in input)) {
    return resolveFreshStartTargetWorkingDirectoryForStart({
      ctx,
      runtime,
    });
  }

  return resolveFreshStartTargetWorkingDirectoryForStart({
    ctx,
    runtime,
    targetWorkingDirectory: input.targetWorkingDirectory,
  });
};

const listenToAgentSessionAndGuard = async ({
  startResult,
  session,
  runtime,
  initialStatusRelease,
}: {
  startResult: Extract<StartOrReuseResult, { kind: "started" }>;
  session: SessionDependencies;
  runtime: RuntimeDependencies;
  initialStatusRelease: InitialSessionStatusReleasePolicy;
}): Promise<void> => {
  const { ctx: startedCtx, runtimeInfo } = startResult;
  const runtimeKind = requireConfiguredRuntimeKind(
    runtimeInfo.runtimeKind,
    `Runtime kind is required to listen to ${startedCtx.role} session '${startedCtx.summary.externalSessionId}'.`,
  );
  const listenerTarget: AgentSessionRef = {
    externalSessionId: startedCtx.summary.externalSessionId,
    repoPath: startedCtx.repoPath,
    runtimeKind,
    workingDirectory: runtimeInfo.workingDirectory,
  };

  await session.listenToAgentSession(listenerTarget);

  if (!startedCtx.isStaleRepoOperation()) {
    if (initialStatusRelease === "after_first_send_attempt") {
      return;
    }

    session.setSessionsById((current) => {
      const currentSession = current[startedCtx.summary.externalSessionId];
      if (currentSession?.status !== "starting") {
        return current;
      }
      return {
        ...current,
        [startedCtx.summary.externalSessionId]: {
          ...currentSession,
          status: "idle",
        },
      };
    });
    return;
  }

  await stopSessionOnStaleAndThrow({
    reason: "start-session-stop-on-stale-after-listener-start",
    runtime,
    startedCtx,
  });
};

const getInitialStatusRelease = (
  input: StartAgentSessionInput,
): InitialSessionStatusReleasePolicy => {
  if (input.startMode === "reuse") {
    return "after_listener_start";
  }

  if (!input.initialStatusRelease) {
    return "after_listener_start";
  }

  return input.initialStatusRelease;
};

export const createStartAgentSession = ({
  repo,
  session,
  runtime,
  task,
  model,
}: StartSessionDependencies) => {
  return async (input: StartAgentSessionInput): Promise<string> => {
    const { taskId, role, startMode } = input;
    const repoPath = requireActiveRepo(repo.activeWorkspace?.repoPath ?? null);
    const workspaceId = repo.activeWorkspace?.workspaceId.trim();
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
      isStaleRepoOperation,
    };

    if (input.startMode === "fresh" && role === "qa") {
      resolveStartTask({ ctx: startCtx, task });
    }
    if (input.startMode === "fresh") {
      void requireSelectedModelRuntimeKindForStart(role, input.selectedModel);
    }

    const normalizedSourceSessionId =
      input.startMode === "fresh" ? "" : input.sourceExternalSessionId.trim();
    const freshStartTarget = await resolveFreshStartTarget({
      input,
      ctx: startCtx,
      runtime,
    });
    const normalizedTargetWorkingDirectory =
      freshStartTarget?.normalizedTargetWorkingDirectory ?? "";
    const selectedModelKey =
      input.startMode === "reuse" ? "" : serializeSelectedModelKey(input.selectedModel);
    const initialStatusRelease = getInitialStatusRelease(input);
    const inFlightKeyParts = [
      repoPath,
      taskId,
      role,
      startMode,
      normalizedSourceSessionId,
      normalizedTargetWorkingDirectory,
      selectedModelKey,
      initialStatusRelease,
    ];
    const inFlightKey = inFlightKeyParts.join("::");
    const existingInFlight = session.inFlightStartsByWorkspaceTaskRef.current.get(inFlightKey);
    if (existingInFlight) {
      return existingInFlight;
    }

    const startPromise = Promise.resolve().then(async (): Promise<string> => {
      let creationInput = toSessionCreationInput({ input });
      const resolvedWorkingDirectory = freshStartTarget?.targetWorkingDirectory;
      if (typeof resolvedWorkingDirectory === "string" || resolvedWorkingDirectory === null) {
        creationInput = toSessionCreationInput({
          input,
          targetWorkingDirectoryOverride: {
            value: resolvedWorkingDirectory,
          },
        });
      }
      const startResult = await createOrReuseSession({
        ctx: startCtx,
        input: creationInput,
        deps: {
          session,
          runtime,
          task,
          model,
        },
      });
      if (startResult.kind === "reused") {
        return startResult.externalSessionId;
      }

      if (creationInput.startMode === "reuse") {
        throw new Error("Started session is missing selected model metadata.");
      }

      await listenToAgentSessionAndGuard({
        startResult,
        session,
        runtime,
        initialStatusRelease,
      });

      return startResult.ctx.summary.externalSessionId;
    });

    session.inFlightStartsByWorkspaceTaskRef.current.set(inFlightKey, startPromise);
    try {
      return await startPromise;
    } finally {
      const currentInFlight = session.inFlightStartsByWorkspaceTaskRef.current.get(inFlightKey);
      if (currentInFlight === startPromise) {
        session.inFlightStartsByWorkspaceTaskRef.current.delete(inFlightKey);
      }
    }
  };
};

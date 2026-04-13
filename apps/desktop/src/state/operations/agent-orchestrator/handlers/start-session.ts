import type { TaskCard } from "@openducktor/contracts";
import {
  type AgentPromptGitContext,
  assertAgentKickoffScenario,
  defaultAgentScenarioForRole,
} from "@openducktor/core";
import { canonicalTargetBranch, effectiveTaskTargetBranch } from "@/lib/target-branch";
import { requireActiveRepo } from "../../tasks/task-operations-model";
import { runOrchestratorSideEffect } from "../support/async-side-effects";
import { createRepoStaleGuard, throwIfRepoStale } from "../support/core";
import { kickoffPromptWithTaskContext } from "../support/scenario";
import type {
  ResolvedRuntimeAndModel,
  RuntimeDependencies,
  SessionDependencies,
  StartAgentSessionInput,
  StartedSessionContext,
  StartOrReuseResult,
  StartSessionContext,
  StartSessionCreationInput,
  StartSessionDependencies,
  TaskDependencies,
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
import { createSessionStartTags } from "./start-session-support";

export type { StartAgentSessionInput, StartSessionDependencies } from "./start-session.types";

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

const attachSessionListenerAndGuard = async ({
  startedCtx,
  session,
  runtime,
}: {
  startedCtx: StartedSessionContext;
  session: SessionDependencies;
  runtime: RuntimeDependencies;
}): Promise<void> => {
  session.attachSessionListener(startedCtx.repoPath, startedCtx.summary.sessionId);

  if (!startedCtx.isStaleRepoOperation()) {
    session.setSessionsById((current) => {
      const currentSession = current[startedCtx.summary.sessionId];
      if (!currentSession || currentSession.status !== "starting") {
        return current;
      }
      return {
        ...current,
        [startedCtx.summary.sessionId]: {
          ...currentSession,
          status: "idle",
        },
      };
    });
    return;
  }

  await stopSessionOnStaleAndThrow({
    reason: "start-session-stop-on-stale-after-listener-attach",
    runtime,
    startedCtx,
  });
};

const resolveKickoffGitContext = async ({
  kickoffScenario,
  repoPath,
  kickoffTargetBranch,
  taskCard,
  model,
}: {
  kickoffScenario: ReturnType<typeof assertAgentKickoffScenario>;
  repoPath: string;
  kickoffTargetBranch: StartAgentSessionInput["kickoffTargetBranch"];
  taskCard: TaskCard;
  model: Pick<StartSessionDependencies, "model">["model"];
}): Promise<AgentPromptGitContext | undefined> => {
  if (kickoffScenario !== "build_pull_request_generation") {
    return undefined;
  }

  if (kickoffTargetBranch) {
    return {
      targetBranch: canonicalTargetBranch(kickoffTargetBranch),
    };
  }

  if (taskCard.targetBranchError) {
    throw new Error(
      `Task "${taskCard.id}" has invalid target branch metadata: ${taskCard.targetBranchError}`,
    );
  }

  const repoDefaultTargetBranch = model.loadRepoDefaultTargetBranch
    ? await model.loadRepoDefaultTargetBranch(repoPath)
    : null;

  return {
    targetBranch: canonicalTargetBranch(
      effectiveTaskTargetBranch(taskCard.targetBranch, repoDefaultTargetBranch),
    ),
  };
};

const maybeSendKickoff = async ({
  sendKickoff,
  startedCtx,
  kickoffTargetBranch,
  task,
  taskCard,
  model,
  promptOverrides,
}: {
  sendKickoff: boolean;
  startedCtx: StartedSessionContext;
  kickoffTargetBranch: StartAgentSessionInput["kickoffTargetBranch"];
  task: TaskDependencies;
  taskCard: TaskCard;
  model: Pick<StartSessionDependencies, "model">["model"];
  promptOverrides: ResolvedRuntimeAndModel["promptOverrides"];
}): Promise<void> => {
  if (!sendKickoff) {
    return;
  }

  const kickoffScenario = assertAgentKickoffScenario(startedCtx.resolvedScenario);
  const git = await resolveKickoffGitContext({
    kickoffScenario,
    repoPath: startedCtx.repoPath,
    kickoffTargetBranch,
    taskCard,
    model,
  });

  throwIfRepoStale(startedCtx.isStaleRepoOperation, STALE_START_ERROR);
  await task.sendAgentMessage(startedCtx.summary.sessionId, [
    {
      kind: "text",
      text: kickoffPromptWithTaskContext(
        startedCtx.role,
        kickoffScenario,
        {
          taskId: startedCtx.taskId,
          title: taskCard.title,
          issueType: taskCard.issueType,
          status: taskCard.status,
          qaRequired: taskCard.aiReviewEnabled,
          description: taskCard.description,
        },
        git,
        promptOverrides,
      ),
    },
  ]);
  throwIfRepoStale(startedCtx.isStaleRepoOperation, STALE_START_ERROR);
  runOrchestratorSideEffect(
    "start-session-refresh-task-data-after-kickoff",
    task.refreshTaskData(startedCtx.repoPath, startedCtx.taskId),
    {
      tags: createSessionStartTags(startedCtx),
    },
  );
};

export const createStartAgentSession = ({
  repo,
  session,
  runtime,
  task,
  model,
}: StartSessionDependencies) => {
  return async (input: StartAgentSessionInput): Promise<string> => {
    const { taskId, role, scenario, sendKickoff = false, startMode } = input;
    const effectiveScenario = scenario ?? defaultAgentScenarioForRole(role);
    const repoPath = requireActiveRepo(repo.activeRepo);
    const isStaleRepoOperation = createRepoStaleGuard({
      repoPath,
      repoEpochRef: repo.repoEpochRef,
      activeRepoRef: repo.activeRepoRef,
      previousRepoRef: repo.previousRepoRef,
    });
    throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);

    const startCtx: StartSessionContext = {
      repoPath,
      taskId,
      role,
      isStaleRepoOperation,
    };

    if (input.startMode === "fresh" && role === "qa") {
      resolveStartTask({ ctx: startCtx, task });
    }

    const normalizedSourceSessionId =
      input.startMode === "fresh" ? "" : input.sourceSessionId.trim();
    const freshStartTarget =
      input.startMode === "fresh"
        ? await resolveFreshStartTargetWorkingDirectoryForStart({
            ctx: startCtx,
            runtime,
            ...(input.targetWorkingDirectory !== undefined
              ? { targetWorkingDirectory: input.targetWorkingDirectory }
              : {}),
          })
        : null;
    const normalizedTargetWorkingDirectory =
      freshStartTarget?.normalizedTargetWorkingDirectory ?? "";
    const selectedModelKey =
      input.startMode === "reuse" ? "" : serializeSelectedModelKey(input.selectedModel);
    const kickoffTargetBranchKey = input.kickoffTargetBranch
      ? canonicalTargetBranch(input.kickoffTargetBranch)
      : "";
    const inFlightKeyParts = [
      repoPath,
      taskId,
      role,
      startMode,
      normalizedSourceSessionId,
      normalizedTargetWorkingDirectory,
      selectedModelKey,
      effectiveScenario,
      sendKickoff ? "kickoff" : "no-kickoff",
    ];
    const inFlightKeySuffix = sendKickoff ? "kickoff" : "no-kickoff";
    const inFlightKey = kickoffTargetBranchKey
      ? [...inFlightKeyParts.slice(0, -1), kickoffTargetBranchKey, inFlightKeySuffix].join("::")
      : inFlightKeyParts.join("::");
    const existingInFlight = session.inFlightStartsByRepoTaskRef.current.get(inFlightKey);
    if (existingInFlight) {
      return existingInFlight;
    }

    const startPromise = Promise.resolve().then(async (): Promise<string> => {
      const startResult = await createOrReuseSession({
        ctx: startCtx,
        input: {
          ...(input.startMode === "fresh"
            ? {
                ...input,
                ...(freshStartTarget?.targetWorkingDirectory !== undefined
                  ? { targetWorkingDirectory: freshStartTarget.targetWorkingDirectory }
                  : {}),
              }
            : input),
          scenario: effectiveScenario,
        },
        deps: {
          session,
          runtime,
          task,
          model,
        },
      });
      if (startResult.kind === "reused") {
        return startResult.sessionId;
      }

      await attachSessionListenerAndGuard({
        startedCtx: startResult.ctx,
        session,
        runtime,
      });

      await maybeSendKickoff({
        sendKickoff,
        startedCtx: startResult.ctx,
        kickoffTargetBranch: input.kickoffTargetBranch,
        task,
        taskCard: startResult.taskCard,
        model,
        promptOverrides: startResult.promptOverrides,
      });

      return startResult.ctx.summary.sessionId;
    });

    session.inFlightStartsByRepoTaskRef.current.set(inFlightKey, startPromise);
    try {
      return await startPromise;
    } finally {
      const currentInFlight = session.inFlightStartsByRepoTaskRef.current.get(inFlightKey);
      if (currentInFlight === startPromise) {
        session.inFlightStartsByRepoTaskRef.current.delete(inFlightKey);
      }
    }
  };
};

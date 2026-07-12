import { toAgentRuntimePolicyBinding, workflowAgentSessionScope } from "@openducktor/core";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { throwIfRepoStale } from "../support/core";
import { createSessionMessagesState } from "../support/messages";
import { historyToChatMessages } from "../support/session-history-chat-messages";
import { buildSessionHeaderMessages } from "../support/session-prompt";
import { resolveAgentSessionRuntimePolicy } from "../support/session-runtime-policy";
import { toRuntimeSessionRefWithPolicy } from "../support/session-runtime-ref";
import type {
  StartAgentSessionInput,
  StartOrReuseResult,
  StartSessionContext,
  StartSessionExecutionDependencies,
} from "./start-session.types";
import { STALE_START_ERROR } from "./start-session-constants";
import { registerStartedSession } from "./start-session-persistence";
import { resolveStartTask } from "./start-session-policies";
import { resolveLoadedSourceSession } from "./start-session-reuse-strategy";
import {
  rollbackStartedSessionBeforeRegistration,
  stopSessionOnStaleAndThrow,
} from "./start-session-rollback";
import { loadStartSystemPrompt } from "./start-session-runtime";

// Match the requested-history loading cap so newly forked child sessions load
// enough history to render immediately without pulling an unbounded transcript.
const FORK_START_HISTORY_LIMIT = 600;

type ForkStrategyInput = {
  ctx: StartSessionContext;
  input: Pick<
    Extract<StartAgentSessionInput, { startMode: "fork" }>,
    "selectedModel" | "sourceSession"
  >;
  deps: StartSessionExecutionDependencies;
};

const readForkSourceRuntime = (
  sourceSession: AgentSessionState,
): {
  runtimeKind: AgentSessionState["runtimeKind"];
  workingDirectory: string;
} => {
  const sourceWorkingDirectory = normalizeWorkingDirectory(sourceSession.workingDirectory);
  if (!sourceWorkingDirectory) {
    throw new Error(
      `Session "${sourceSession.externalSessionId}" is missing working directory metadata required for forking.`,
    );
  }

  return { runtimeKind: sourceSession.runtimeKind, workingDirectory: sourceWorkingDirectory };
};

export const executeForkStart = async ({
  ctx,
  input,
  deps,
}: ForkStrategyInput): Promise<Extract<StartOrReuseResult, { kind: "started" }>> => {
  const sourceSession = await resolveLoadedSourceSession({
    ctx,
    deps,
    sourceSession: input.sourceSession,
  });
  const { runtimeKind: sourceRuntimeKind, workingDirectory } = readForkSourceRuntime(sourceSession);
  const [canonicalWorkingDirectory, canonicalRepoPath] = await Promise.all([
    deps.runtime.canonicalizePath(workingDirectory),
    deps.runtime.canonicalizePath(ctx.repoPath),
  ]);
  if (
    normalizeWorkingDirectory(canonicalWorkingDirectory) ===
    normalizeWorkingDirectory(canonicalRepoPath)
  ) {
    throw new Error(
      `Session "${sourceSession.externalSessionId}" is a legacy repository-root task session and cannot be forked. Start a fresh session in the task worktree instead.`,
    );
  }
  const taskCard = resolveStartTask({ ctx, task: deps.task });
  const selectedModel = input.selectedModel;

  if (selectedModel.runtimeKind && sourceRuntimeKind !== selectedModel.runtimeKind) {
    throw new Error(
      `Session "${input.sourceSession.externalSessionId}" cannot be forked with runtime "${selectedModel.runtimeKind}" because it belongs to runtime "${sourceRuntimeKind}".`,
    );
  }

  const leaseId = await deps.runtime.prepareTaskSessionStartupLease(
    ctx.repoPath,
    ctx.taskId,
    ctx.role,
  );
  try {
    const systemPrompt = await loadStartSystemPrompt({
      ctx,
      taskCard,
      deps,
    });

    const runtimeKind = sourceRuntimeKind;
    const sessionScope = workflowAgentSessionScope(ctx.taskId, ctx.role);
    const loadSettingsSnapshot = deps.model.loadSettingsSnapshot;
    const runtimePolicy = await resolveAgentSessionRuntimePolicy({
      runtimeKind,
      sessionScope,
      loadSettingsSnapshot,
    });

    const summary = await deps.runtime.adapter.forkSession({
      repoPath: ctx.repoPath,
      ...toAgentRuntimePolicyBinding({ runtimeKind, runtimePolicy }),
      workingDirectory,
      sessionScope,
      systemPrompt,
      ...(selectedModel ? { model: selectedModel } : {}),
      parentExternalSessionId: sourceSession.externalSessionId,
    });

    const startedCtx = {
      ...ctx,
      summary,
    };

    if (ctx.isStaleRepoOperation()) {
      await stopSessionOnStaleAndThrow({
        reason: "start-session-stop-on-stale-after-fork",
        runtime: deps.runtime,
        startedCtx,
      });
    }

    const forkHistory = await deps.runtime.adapter
      .loadSessionHistory({
        ...toRuntimeSessionRefWithPolicy(
          ctx.repoPath,
          {
            externalSessionId: summary.externalSessionId,
            runtimeKind: summary.runtimeKind,
            workingDirectory: summary.workingDirectory,
            selectedModel: null,
          },
          runtimePolicy,
        ),
        limit: FORK_START_HISTORY_LIMIT,
      })
      .catch((error) =>
        rollbackStartedSessionBeforeRegistration({
          error,
          startedCtx,
          runtime: deps.runtime,
          reason: "start-session-stop-after-fork-history-load-failure",
        }),
      );

    if (ctx.isStaleRepoOperation()) {
      await stopSessionOnStaleAndThrow({
        reason: "start-session-stop-on-stale-after-fork-history-load",
        runtime: deps.runtime,
        startedCtx,
      });
    }
    throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);

    const initialMessages: AgentSessionState["messages"] = createSessionMessagesState(
      summary.externalSessionId,
      [
        ...buildSessionHeaderMessages({
          externalSessionId: summary.externalSessionId,
          systemPrompt,
          startedAt: summary.startedAt,
        }),
        ...historyToChatMessages(forkHistory, {
          role: ctx.role,
        }),
      ],
    );

    const forkedRuntime = {
      runtimeKind: summary.runtimeKind,
      workingDirectory: summary.workingDirectory,
      bootstrap: {
        complete: () =>
          deps.runtime.completeTaskSessionStartupLease(ctx.repoPath, ctx.taskId, leaseId),
        abort: () => deps.runtime.abortTaskSessionStartupLease(ctx.repoPath, ctx.taskId, leaseId),
      },
    };

    return await registerStartedSession({
      ctx,
      startedCtx,
      runtimeInfo: forkedRuntime,
      runtimePolicy,
      systemPrompt,
      selectedModel,
      initialMessages,
      deps,
      taskCard,
    });
  } catch (error) {
    try {
      await deps.runtime.abortTaskSessionStartupLease(ctx.repoPath, ctx.taskId, leaseId);
    } catch (abortError) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} Failed to release the task session startup lease: ${abortError instanceof Error ? abortError.message : String(abortError)}`,
        error instanceof Error ? { cause: error } : undefined,
      );
    }
    throw error;
  }
};

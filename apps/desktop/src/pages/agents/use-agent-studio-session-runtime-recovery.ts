import type { RunSummary } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { normalizeWorkingDirectory } from "@/state/operations/agent-orchestrator/support/core";
import { repoTaskDataQueryOptions } from "@/state/queries/tasks";
import type { AgentSessionState } from "@/types/agent-orchestrator";

const RUNTIME_RECOVERY_POLLING_INTERVAL_MS = 2_000;

export type RuntimeRecoveryRuntimeSource = {
  kind: string;
  runtimeId: string;
  workingDirectory: string;
  route: string;
};

const toRuntimeRecoverySignalEntry = (parts: readonly string[]): string => JSON.stringify(parts);

export const buildSelectedSessionRuntimeRecoverySignal = ({
  activeTaskId,
  session,
  runs,
  runtimes,
}: {
  activeTaskId: string;
  session: Pick<AgentSessionState, "role" | "runtimeKind" | "workingDirectory"> | null;
  runs: RunSummary[];
  runtimes: RuntimeRecoveryRuntimeSource[];
}): string => {
  if (!session?.runtimeKind) {
    return "";
  }

  const workingDirectory = normalizeWorkingDirectory(session.workingDirectory);
  const relevantRuns = runs.filter((run) => {
    if (run.runtimeKind !== session.runtimeKind) {
      return false;
    }

    if (normalizeWorkingDirectory(run.worktreePath) !== workingDirectory) {
      return false;
    }

    if ((session.role === "build" || session.role === "qa") && run.taskId !== activeTaskId) {
      return false;
    }

    return true;
  });
  const relevantRuntimes = runtimes.filter((runtime) => {
    return (
      runtime.kind === session.runtimeKind &&
      normalizeWorkingDirectory(runtime.workingDirectory) === workingDirectory
    );
  });

  return [
    ...relevantRuns.map((run) =>
      toRuntimeRecoverySignalEntry([
        run.runId,
        run.taskId,
        run.state,
        run.worktreePath,
        run.runtimeKind,
      ]),
    ),
    ...relevantRuntimes.map((runtime) =>
      toRuntimeRecoverySignalEntry([
        runtime.kind,
        runtime.runtimeId,
        runtime.workingDirectory,
        runtime.route,
      ]),
    ),
  ]
    .sort()
    .join("|");
};

export function useAgentStudioSessionRuntimeRecovery({
  activeTaskId,
  activeSessionId,
  shouldWaitForSessionRuntime,
  activeRecoveryKey,
  sessionRuntimeRecoverySignal,
  recoverSessionRuntimeAttachment,
  refreshSessionRuntimeRecoverySources,
}: {
  activeTaskId: string;
  activeSessionId: string | null;
  shouldWaitForSessionRuntime: boolean;
  activeRecoveryKey: string | null;
  sessionRuntimeRecoverySignal: string;
  recoverSessionRuntimeAttachment: (input: {
    taskId: string;
    sessionId: string;
    recoveryDedupKey?: string | null;
  }) => Promise<boolean>;
  refreshSessionRuntimeRecoverySources: () => Promise<void>;
}): void {
  const [lastRuntimeRecoveryAttemptKey, setLastRuntimeRecoveryAttemptKey] = useState<string | null>(
    null,
  );
  const runtimeRecoveryAttemptKey = useMemo(
    () =>
      shouldWaitForSessionRuntime && activeRecoveryKey
        ? `${activeRecoveryKey}::${sessionRuntimeRecoverySignal}`
        : null,
    [activeRecoveryKey, sessionRuntimeRecoverySignal, shouldWaitForSessionRuntime],
  );

  useEffect(() => {
    if (!activeSessionId) {
      setLastRuntimeRecoveryAttemptKey(null);
    }
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeSessionId || !runtimeRecoveryAttemptKey) {
      return;
    }

    if (lastRuntimeRecoveryAttemptKey === runtimeRecoveryAttemptKey) {
      return;
    }

    setLastRuntimeRecoveryAttemptKey(runtimeRecoveryAttemptKey);
    void recoverSessionRuntimeAttachment({
      taskId: activeTaskId,
      sessionId: activeSessionId,
      recoveryDedupKey: runtimeRecoveryAttemptKey,
    }).catch(() => {
      // The operation layer surfaces actionable errors.
    });
  }, [
    activeSessionId,
    activeTaskId,
    lastRuntimeRecoveryAttemptKey,
    recoverSessionRuntimeAttachment,
    runtimeRecoveryAttemptKey,
  ]);

  useEffect(() => {
    if (!activeSessionId || !shouldWaitForSessionRuntime) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshSessionRuntimeRecoverySources().catch(() => {
        // The refresh path is best-effort; recovery attempts surface actionable failures.
      });
    }, RUNTIME_RECOVERY_POLLING_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeSessionId, refreshSessionRuntimeRecoverySources, shouldWaitForSessionRuntime]);
}

export const refreshSelectedSessionRuntimeRecoverySources = async ({
  queryClient,
  repoPath,
  refetchRuntimeLists,
}: {
  queryClient: QueryClient;
  repoPath: string;
  refetchRuntimeLists: Array<() => Promise<unknown>>;
}): Promise<void> => {
  await Promise.all([
    queryClient.fetchQuery({
      ...repoTaskDataQueryOptions(repoPath),
      staleTime: 0,
    }),
    ...refetchRuntimeLists.map((refetch) => refetch()),
  ]);
};

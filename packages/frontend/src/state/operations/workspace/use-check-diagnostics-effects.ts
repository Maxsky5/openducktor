import type { RuntimeCheck, TaskStoreCheck } from "@openducktor/contracts";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { RepoRuntimeHealthMap } from "@/types/diagnostics";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { DiagnosticsRetryPlan, DiagnosticsToastIssue } from "./check-diagnostics";

const RUNTIME_HEALTH_TIMEOUT_RETRY_DELAY_MS = 2_000;

export type DiagnosticsToastApi = {
  error: (
    message: string,
    options?: { description?: string; id?: string; duration?: number },
  ) => unknown;
  dismiss: (toastId?: string | number) => unknown;
};

export function useDiagnosticsToasts(
  diagnosticsToastIssues: DiagnosticsToastIssue[],
  toastApi: DiagnosticsToastApi = toast,
): void {
  const issueSignaturesRef = useRef<Map<string, string> | null>(null);
  if (issueSignaturesRef.current === null) {
    issueSignaturesRef.current = new Map<string, string>();
  }
  const issueSignatures = issueSignaturesRef.current;

  useEffect(() => {
    const nextIssueIds = new Set(diagnosticsToastIssues.map((issue) => issue.id));

    for (const issueId of [...issueSignatures.keys()]) {
      if (nextIssueIds.has(issueId)) {
        continue;
      }

      toastApi.dismiss(issueId);
      issueSignatures.delete(issueId);
    }

    for (const issue of diagnosticsToastIssues) {
      const signature = `${issue.severity}:${issue.title}:${issue.description}`;
      if (issueSignatures.get(issue.id) === signature) {
        continue;
      }

      toastApi.error(issue.title, {
        id: issue.id,
        description: issue.description,
        duration: Number.POSITIVE_INFINITY,
      });

      issueSignatures.set(issue.id, signature);
    }
  }, [diagnosticsToastIssues, issueSignatures, toastApi]);

  const dismissTrackedIssues = useCallback(() => {
    for (const issueId of issueSignatures.keys()) {
      toastApi.dismiss(issueId);
    }
    issueSignatures.clear();
  }, [issueSignatures, toastApi]);

  useEffect(() => dismissTrackedIssues, [dismissTrackedIssues]);
}

type UseDiagnosticsRetrySchedulerArgs = {
  activeWorkspace: ActiveWorkspace | null;
  retryPlan: DiagnosticsRetryPlan;
  refreshRuntimeCheck: (force?: boolean) => Promise<RuntimeCheck>;
  refreshTaskStoreCheckForRepo: (repoPath: string, force?: boolean) => Promise<TaskStoreCheck>;
  refreshRepoRuntimeHealthForRepo: (
    repoPath: string,
    force?: boolean,
  ) => Promise<RepoRuntimeHealthMap>;
};

export function useDiagnosticsRetryScheduler({
  activeWorkspace,
  retryPlan,
  refreshRuntimeCheck,
  refreshTaskStoreCheckForRepo,
  refreshRepoRuntimeHealthForRepo,
}: UseDiagnosticsRetrySchedulerArgs): void {
  const diagnosticsRetryTimeoutRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const activeRepoPath = activeWorkspace?.repoPath ?? null;

  useEffect(() => {
    if (diagnosticsRetryTimeoutRef.current !== null) {
      globalThis.clearTimeout(diagnosticsRetryTimeoutRef.current);
      diagnosticsRetryTimeoutRef.current = null;
    }

    if (
      !retryPlan.retryRuntimeCheck &&
      !retryPlan.retryTaskStoreCheck &&
      !retryPlan.retryRuntimeHealth
    ) {
      return;
    }

    diagnosticsRetryTimeoutRef.current = globalThis.setTimeout(() => {
      diagnosticsRetryTimeoutRef.current = null;
      const retries: Promise<unknown>[] = [];

      if (retryPlan.retryRuntimeCheck) {
        retries.push(refreshRuntimeCheck(true));
      }

      if (retryPlan.retryTaskStoreCheck && activeRepoPath !== null) {
        retries.push(refreshTaskStoreCheckForRepo(activeRepoPath, true));
      }

      if (retryPlan.retryRuntimeHealth && activeRepoPath !== null) {
        retries.push(refreshRepoRuntimeHealthForRepo(activeRepoPath, true));
      }

      void Promise.allSettled(retries);
    }, RUNTIME_HEALTH_TIMEOUT_RETRY_DELAY_MS);

    return () => {
      if (diagnosticsRetryTimeoutRef.current !== null) {
        globalThis.clearTimeout(diagnosticsRetryTimeoutRef.current);
        diagnosticsRetryTimeoutRef.current = null;
      }
    };
  }, [
    activeRepoPath,
    refreshTaskStoreCheckForRepo,
    refreshRepoRuntimeHealthForRepo,
    refreshRuntimeCheck,
    retryPlan,
  ]);

  const clearDiagnosticsRetryTimeout = useCallback(() => {
    if (diagnosticsRetryTimeoutRef.current !== null) {
      globalThis.clearTimeout(diagnosticsRetryTimeoutRef.current);
      diagnosticsRetryTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => clearDiagnosticsRetryTimeout, [clearDiagnosticsRetryTimeout]);
}

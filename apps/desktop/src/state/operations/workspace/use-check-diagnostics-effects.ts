import type { BeadsCheck, RuntimeCheck } from "@openducktor/contracts";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { RepoRuntimeHealthMap } from "@/types/diagnostics";
import type { DiagnosticsRetryPlan, DiagnosticsToastIssue } from "./check-diagnostics";

const RUNTIME_HEALTH_TIMEOUT_RETRY_DELAY_MS = 2_000;

export function useDiagnosticsToasts(diagnosticsToastIssues: DiagnosticsToastIssue[]): void {
  const issueSignaturesRef = useRef(new Map<string, string>());

  useEffect(() => {
    const nextIssueIds = new Set(diagnosticsToastIssues.map((issue) => issue.id));

    for (const issueId of [...issueSignaturesRef.current.keys()]) {
      if (nextIssueIds.has(issueId)) {
        continue;
      }

      toast.dismiss(issueId);
      issueSignaturesRef.current.delete(issueId);
    }

    for (const issue of diagnosticsToastIssues) {
      const signature = `${issue.severity}:${issue.title}:${issue.description}`;
      if (issueSignaturesRef.current.get(issue.id) === signature) {
        continue;
      }

      toast.error(issue.title, {
        id: issue.id,
        description: issue.description,
        duration: Number.POSITIVE_INFINITY,
      });

      issueSignaturesRef.current.set(issue.id, signature);
    }
  }, [diagnosticsToastIssues]);

  useEffect(() => {
    return () => {
      for (const issueId of issueSignaturesRef.current.keys()) {
        toast.dismiss(issueId);
      }
      issueSignaturesRef.current.clear();
    };
  }, []);
}

type UseDiagnosticsRetrySchedulerArgs = {
  activeRepo: string | null;
  retryPlan: DiagnosticsRetryPlan;
  refreshRuntimeCheck: (force?: boolean) => Promise<RuntimeCheck>;
  refreshBeadsCheckForRepo: (repoPath: string, force?: boolean) => Promise<BeadsCheck>;
  refreshRepoRuntimeHealthForRepo: (
    repoPath: string,
    force?: boolean,
  ) => Promise<RepoRuntimeHealthMap>;
};

export function useDiagnosticsRetryScheduler({
  activeRepo,
  retryPlan,
  refreshRuntimeCheck,
  refreshBeadsCheckForRepo,
  refreshRepoRuntimeHealthForRepo,
}: UseDiagnosticsRetrySchedulerArgs): void {
  const diagnosticsRetryTimeoutRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);

  useEffect(() => {
    if (diagnosticsRetryTimeoutRef.current !== null) {
      globalThis.clearTimeout(diagnosticsRetryTimeoutRef.current);
      diagnosticsRetryTimeoutRef.current = null;
    }

    if (
      !retryPlan.retryRuntimeCheck &&
      !retryPlan.retryBeadsCheck &&
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

      if (retryPlan.retryBeadsCheck && activeRepo !== null) {
        retries.push(refreshBeadsCheckForRepo(activeRepo, true));
      }

      if (retryPlan.retryRuntimeHealth && activeRepo !== null) {
        retries.push(refreshRepoRuntimeHealthForRepo(activeRepo, true));
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
    activeRepo,
    refreshBeadsCheckForRepo,
    refreshRepoRuntimeHealthForRepo,
    refreshRuntimeCheck,
    retryPlan,
  ]);

  useEffect(() => {
    return () => {
      if (diagnosticsRetryTimeoutRef.current !== null) {
        globalThis.clearTimeout(diagnosticsRetryTimeoutRef.current);
      }
    };
  }, []);
}

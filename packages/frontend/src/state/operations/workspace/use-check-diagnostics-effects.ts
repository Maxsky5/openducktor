import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { DiagnosticsToastIssue } from "./check-diagnostics";

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

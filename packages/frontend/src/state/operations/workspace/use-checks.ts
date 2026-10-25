import { useMemo } from "react";
import { buildDiagnosticsToastIssues } from "@openducktor/frontend-core/diagnostics/check-diagnostics";
import {
  type DiagnosticsChecks,
  useDiagnosticsChecks,
  type UseDiagnosticsChecksArgs,
} from "@openducktor/frontend-core/diagnostics/use-diagnostics-checks";
import { type DiagnosticsToastApi, useDiagnosticsToasts } from "./use-check-diagnostics-effects";

type UseChecksArgs = UseDiagnosticsChecksArgs & {
  toastApi?: DiagnosticsToastApi;
};

/** The shared host checks, plus desktop toasts for the failures they report. */
export function useChecks({ toastApi, ...args }: UseChecksArgs): DiagnosticsChecks {
  const checks = useDiagnosticsChecks(args);
  const { activeWorkspace } = args;
  const { pathCheck, gitCheck, taskStoreCheck } = checks;
  const diagnosticsToastIssues = useMemo(
    () =>
      buildDiagnosticsToastIssues({
        activeWorkspace,
        pathCheck,
        gitCheck,
        taskStoreCheck,
      }),
    [activeWorkspace, pathCheck, gitCheck, taskStoreCheck],
  );
  useDiagnosticsToasts(diagnosticsToastIssues, toastApi);
  return checks;
}

import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import { buildSpecStateValue } from "../app-state-context-values";
import { SpecStateContext, useActiveWorkspaceContext } from "../app-state-contexts";
import { useSpecOperations } from "../operations/tasks/use-spec-operations";

export function SpecStateProvider({ children }: PropsWithChildren): ReactElement {
  const { activeWorkspace } = useActiveWorkspaceContext();
  const {
    loadSpec,
    loadSpecDocument,
    loadPlanDocument,
    loadQaReportDocument,
    saveSpec,
    saveSpecArtifact,
    savePlanArtifact,
  } = useSpecOperations({
    activeWorkspace,
  });

  const specStateValue = useMemo(
    () =>
      buildSpecStateValue({
        loadSpec,
        loadSpecDocument,
        loadPlanDocument,
        loadQaReportDocument,
        saveSpec,
        saveSpecArtifact,
        savePlanArtifact,
      }),
    [
      loadPlanDocument,
      loadQaReportDocument,
      loadSpec,
      loadSpecDocument,
      saveSpec,
      saveSpecArtifact,
      savePlanArtifact,
    ],
  );

  return <SpecStateContext.Provider value={specStateValue}>{children}</SpecStateContext.Provider>;
}

import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import { buildSpecStateValue } from "../app-state-context-values";
import { SpecStateContext, useActiveWorkspaceContext } from "../app-state-contexts";
import { useSpecOperations } from "../operations";

export function SpecStateProvider({ children }: PropsWithChildren): ReactElement {
  const { activeWorkspace } = useActiveWorkspaceContext();
  const {
    loadSpec,
    loadSpecDocument,
    loadPlanDocument,
    loadQaReportDocument,
    saveSpec,
    saveSpecDocument,
    savePlanDocument,
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
        saveSpecDocument,
        savePlanDocument,
      }),
    [
      loadPlanDocument,
      loadQaReportDocument,
      loadSpec,
      loadSpecDocument,
      saveSpec,
      saveSpecDocument,
      savePlanDocument,
    ],
  );

  return <SpecStateContext.Provider value={specStateValue}>{children}</SpecStateContext.Provider>;
}

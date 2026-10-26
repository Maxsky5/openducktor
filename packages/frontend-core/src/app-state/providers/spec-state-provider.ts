import type { SpecStateContextValue } from "../../types/state-slices";
import { createElement, type PropsWithChildren, type ReactElement, useMemo } from "react";
import { SpecStateContext, useActiveWorkspaceContext } from "../app-state-contexts";
import { useSpecOperations } from "../../tasks/operations/use-spec-operations";

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
    (): SpecStateContextValue => ({
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

  return createElement(SpecStateContext.Provider, { value: specStateValue }, children);
}

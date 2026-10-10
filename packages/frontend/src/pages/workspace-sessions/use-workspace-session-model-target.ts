import type { WorkspaceSession } from "@openducktor/contracts";
import { useMemo } from "react";
import type { RuntimeReadinessState } from "@/lib/runtime-readiness";
import type { SessionModelTarget } from "./workspace-session-model-resources";
import { useWorkspaceSessionModelCatalog } from "./use-workspace-session-model-catalog";

/** Keeps catalog reads and model writes bound to the saved chat target. */
export function useWorkspaceSessionModelTarget({
  repoPath,
  record,
  identity,
  selection,
  readinessState,
  updateDraft,
  updateSpeed,
  update,
}: {
  repoPath: string;
  record: WorkspaceSession;
  identity: SessionModelTarget["identity"];
  selection: SessionModelTarget["selection"];
  readinessState: RuntimeReadinessState;
  updateDraft: NonNullable<SessionModelTarget["updateDraft"]>;
  updateSpeed: NonNullable<SessionModelTarget["updateSpeed"]>;
  update: SessionModelTarget["update"];
}): SessionModelTarget {
  const runtimeKind = record.runtimeKind;
  const workingDirectory = record.executionTarget.workingDirectory;
  const runtimeRef = useMemo(
    () => ({ repoPath, runtimeKind, workingDirectory }),
    [repoPath, runtimeKind, workingDirectory],
  );
  const { catalog, error, isLoading, retry } = useWorkspaceSessionModelCatalog(
    runtimeRef,
    readinessState,
  );
  return useMemo(
    () => ({
      identity,
      runtimeKind,
      runtimeRef,
      updateDraft,
      updateSpeed,
      selection,
      catalog,
      isLoading,
      error,
      retry,
      update,
    }),
    [
      identity,
      runtimeKind,
      runtimeRef,
      updateDraft,
      updateSpeed,
      selection,
      catalog,
      isLoading,
      error,
      retry,
      update,
    ],
  );
}

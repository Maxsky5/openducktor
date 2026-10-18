import type { WorkspaceSession } from "@openducktor/contracts";
import { useMemo } from "react";
import { useRuntimeAvailabilityContext } from "@/state/app-state-contexts";
import { useRuntimeModelCatalogQuery } from "@openducktor/frontend-core/queries/use-runtime-model-catalogs";
import type { SessionModelTarget } from "./workspace-session-model-resources";

/** Keeps catalog reads and model writes bound to the saved chat target. */
export function useWorkspaceSessionModelTarget({
  repoPath,
  record,
  identity,
  selection,
  updateDraft,
  updateSpeed,
  update,
}: {
  repoPath: string;
  record: WorkspaceSession;
  identity: SessionModelTarget["identity"];
  selection: SessionModelTarget["selection"];
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
  const { loadRepoRuntimeCatalog } = useRuntimeAvailabilityContext();
  const { catalog, error, isLoading, retry } = useRuntimeModelCatalogQuery({
    runtimeRef,
    loadRuntimeCatalog: loadRepoRuntimeCatalog,
  });
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

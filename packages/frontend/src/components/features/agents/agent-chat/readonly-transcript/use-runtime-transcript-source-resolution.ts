import type { RuntimeInstanceSummary } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import { runtimeListQueryOptions } from "@/state/queries/runtime";
import type { RuntimeSessionTranscriptSource } from "./runtime-session-transcript-source";
import { errorMessageFromUnknown } from "./runtime-transcript-error";

type UseRuntimeTranscriptSourceResolutionArgs = {
  isOpen: boolean;
  workspaceRepoPath: string | null;
  source: RuntimeSessionTranscriptSource | null;
};

export type RuntimeTranscriptSourceResolution = {
  isPending: boolean;
  error: string | null;
  runtimeId: string | null;
};

const matchesSourceRuntime = (
  runtime: RuntimeInstanceSummary,
  source: RuntimeSessionTranscriptSource,
): boolean => {
  if (runtime.kind !== source.runtimeKind) {
    return false;
  }
  if (source.runtimeId) {
    return runtime.runtimeId === source.runtimeId;
  }
  return runtime.workingDirectory === source.workingDirectory;
};

export function useRuntimeTranscriptSourceResolution({
  isOpen,
  workspaceRepoPath,
  source,
}: UseRuntimeTranscriptSourceResolutionArgs): RuntimeTranscriptSourceResolution {
  const queryEnabled = Boolean(isOpen && workspaceRepoPath && source);
  const runtimeListQuery = useQuery({
    ...runtimeListQueryOptions(
      source?.runtimeKind ?? DEFAULT_RUNTIME_KIND,
      workspaceRepoPath ?? "",
    ),
    enabled: queryEnabled,
  });

  if (!source || !queryEnabled) {
    return { isPending: false, error: null, runtimeId: null };
  }
  if (runtimeListQuery.isPending) {
    return { isPending: true, error: null, runtimeId: null };
  }
  if (runtimeListQuery.error) {
    return {
      isPending: false,
      error: errorMessageFromUnknown(
        runtimeListQuery.error,
        `Failed to load ${source.runtimeKind} runtimes.`,
      ),
      runtimeId: null,
    };
  }

  const matches = (runtimeListQuery.data ?? []).filter((runtime) =>
    matchesSourceRuntime(runtime, source),
  );
  if (matches.length !== 1) {
    const errorPrefix = matches.length === 0 ? "No" : "Multiple";
    const runtimeSubject =
      matches.length === 0
        ? `${source.runtimeKind} runtime instance is`
        : `${source.runtimeKind} runtime instances are`;
    return {
      isPending: false,
      error: `${errorPrefix} ${runtimeSubject} attached for ${source.runtimeId ?? source.workingDirectory}.`,
      runtimeId: null,
    };
  }

  const [runtime] = matches as [RuntimeInstanceSummary];

  return {
    isPending: false,
    error: null,
    runtimeId: runtime.runtimeId,
  };
}

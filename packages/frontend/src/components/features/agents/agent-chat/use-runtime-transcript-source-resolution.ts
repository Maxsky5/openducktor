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
  return runtime.runtimeId === source.runtimeId;
};

export function useRuntimeTranscriptSourceResolution({
  isOpen,
  workspaceRepoPath,
  source,
}: UseRuntimeTranscriptSourceResolutionArgs): RuntimeTranscriptSourceResolution {
  const runtimeListQuery = useQuery({
    ...runtimeListQueryOptions(
      source?.runtimeKind ?? DEFAULT_RUNTIME_KIND,
      workspaceRepoPath ?? "",
    ),
    enabled: Boolean(isOpen && workspaceRepoPath && source),
  });

  if (!source) {
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
    return {
      isPending: false,
      error: `${errorPrefix} ${source.runtimeKind} runtime is attached for ${source.runtimeId}.`,
      runtimeId: null,
    };
  }

  const [runtime] = matches;
  if (!runtime) {
    return {
      isPending: false,
      error: `No ${source.runtimeKind} runtime is attached for ${source.runtimeId}.`,
      runtimeId: null,
    };
  }

  return {
    isPending: false,
    error: null,
    runtimeId: runtime.runtimeId,
  };
}

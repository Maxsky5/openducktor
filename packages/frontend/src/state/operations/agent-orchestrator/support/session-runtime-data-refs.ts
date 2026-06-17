import type { RepoRuntimeRef, RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentSessionRef } from "@openducktor/core";
import { findRuntimeDefinition, runtimeSupportsCapability } from "@/lib/agent-runtime";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { toRuntimeSessionRef } from "./session-runtime-ref";

export type SessionRuntimeDataRefs = {
  catalogRef: RepoRuntimeRef | null;
  todosRef: AgentSessionRef | null;
  error: string | null;
};

export type ResolveSessionRuntimeDataRefsInput = {
  repoPath: string | null;
  selectedSessionIdentity: AgentSessionIdentity | null;
  runtimeDefinitions: RuntimeDescriptor[];
};

export const emptySessionRuntimeDataRefs: SessionRuntimeDataRefs = Object.freeze({
  catalogRef: null,
  todosRef: null,
  error: null,
});

const runtimeSupportsTodos = (
  runtimeDefinitions: RuntimeDescriptor[],
  selectedSessionIdentity: AgentSessionIdentity,
): boolean => {
  const runtimeDefinition = findRuntimeDefinition(
    runtimeDefinitions,
    selectedSessionIdentity.runtimeKind,
  );
  return runtimeDefinition
    ? runtimeSupportsCapability(runtimeDefinition, "optionalSurfaces.supportsTodos")
    : false;
};

export const resolveSessionRuntimeDataRefs = ({
  repoPath,
  selectedSessionIdentity,
  runtimeDefinitions,
}: ResolveSessionRuntimeDataRefsInput): SessionRuntimeDataRefs => {
  if (!selectedSessionIdentity) {
    return emptySessionRuntimeDataRefs;
  }

  if (!repoPath) {
    return {
      ...emptySessionRuntimeDataRefs,
      error: "Repository path is required to read selected session runtime data.",
    };
  }

  const catalogRef: RepoRuntimeRef = {
    repoPath,
    runtimeKind: selectedSessionIdentity.runtimeKind,
  };

  if (!runtimeSupportsTodos(runtimeDefinitions, selectedSessionIdentity)) {
    return {
      catalogRef,
      todosRef: null,
      error: null,
    };
  }

  return {
    catalogRef,
    todosRef: toRuntimeSessionRef(repoPath, selectedSessionIdentity),
    error: null,
  };
};

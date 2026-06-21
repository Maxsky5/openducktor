import type { RepoRuntimeRef, RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentSessionRef } from "@openducktor/core";
import { findRuntimeDefinition, runtimeSupportsCapability } from "@/lib/agent-runtime";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { toRuntimeSessionRef } from "./session-runtime-ref";

export type SessionRuntimeDataRefs =
  | { kind: "none" }
  | { kind: "unavailable"; error: string }
  | { kind: "available"; catalogRef: RepoRuntimeRef; todosRef: AgentSessionRef | null };

export type ResolveSessionRuntimeDataRefsInput = {
  repoPath: string | null;
  selectedSessionIdentity: AgentSessionIdentity | null;
  runtimeDefinitions: RuntimeDescriptor[];
};

export const emptySessionRuntimeDataRefs: SessionRuntimeDataRefs = Object.freeze({
  kind: "none",
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
      kind: "unavailable",
      error: "Repository path is required to read selected session runtime data.",
    };
  }

  const catalogRef: RepoRuntimeRef = {
    repoPath,
    runtimeKind: selectedSessionIdentity.runtimeKind,
  };

  if (!runtimeSupportsTodos(runtimeDefinitions, selectedSessionIdentity)) {
    return {
      kind: "available",
      catalogRef,
      todosRef: null,
    };
  }

  return {
    kind: "available",
    catalogRef,
    todosRef: toRuntimeSessionRef(repoPath, selectedSessionIdentity),
  };
};

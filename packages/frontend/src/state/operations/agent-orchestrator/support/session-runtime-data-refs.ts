import type { RepoRuntimeRef, RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentSessionHydrationRef } from "@openducktor/core";
import { findRuntimeDefinition, runtimeSupportsCapability } from "@/lib/agent-runtime";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { toRuntimeSessionContextRef, toRuntimeSessionRef } from "./session-runtime-ref";

export type SessionRuntimeDataRefs =
  | { kind: "none" }
  | { kind: "unavailable"; error: string }
  | { kind: "available"; catalogRef: RepoRuntimeRef; todosRef: AgentSessionHydrationRef | null };

export type ResolveSessionRuntimeDataRefsInput = {
  repoPath: string | null;
  selectedSessionIdentity: (AgentSessionIdentity | AgentSessionState) | null;
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
    todosRef:
      "role" in selectedSessionIdentity
        ? toRuntimeSessionContextRef(repoPath, selectedSessionIdentity)
        : toRuntimeSessionRef(repoPath, selectedSessionIdentity),
  };
};

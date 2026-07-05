import type { RepoRuntimeRef, RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentSessionRuntimePolicy, PolicyBoundSessionRef } from "@openducktor/core";
import { findRuntimeDefinition, runtimeSupportsCapability } from "@/lib/agent-runtime";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { toRuntimeSessionRefWithPolicy } from "./session-runtime-ref";

type SessionRuntimeDataSource =
  | AgentSessionIdentity
  | (AgentSessionIdentity & { selectedModel?: AgentSessionState["selectedModel"] });

export type SessionRuntimeDataRefs =
  | { kind: "none" }
  | { kind: "unavailable"; error: string }
  | { kind: "available"; catalogRef: RepoRuntimeRef; todosRef: PolicyBoundSessionRef | null };

export type ResolveSessionRuntimeDataRefsInput = {
  repoPath: string | null;
  selectedSessionIdentity: SessionRuntimeDataSource | null;
  runtimePolicy: AgentSessionRuntimePolicy | null;
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
  runtimePolicy,
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

  if (!runtimePolicy) {
    return {
      kind: "available",
      catalogRef,
      todosRef: null,
    };
  }

  return {
    kind: "available",
    catalogRef,
    todosRef: toRuntimeSessionRefWithPolicy(repoPath, selectedSessionIdentity, runtimePolicy),
  };
};

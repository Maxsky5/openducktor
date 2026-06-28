import type { RepoRuntimeRef, RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentSessionRuntimePolicy, AgentSessionRuntimeRef } from "@openducktor/core";
import { findRuntimeDefinition, runtimeSupportsCapability } from "@/lib/agent-runtime";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { toRuntimeSessionContextRef } from "./session-runtime-ref";

type SessionRuntimeDataSource =
  | AgentSessionIdentity
  | Pick<
      AgentSessionState,
      "externalSessionId" | "runtimeKind" | "workingDirectory" | "taskId" | "role" | "selectedModel"
    >;

export type SessionRuntimeDataRefs =
  | { kind: "none" }
  | { kind: "unavailable"; error: string }
  | { kind: "available"; catalogRef: RepoRuntimeRef; todosRef: AgentSessionRuntimeRef | null };

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

  if (!("role" in selectedSessionIdentity) || selectedSessionIdentity.role === null) {
    return {
      kind: "unavailable",
      error: `Session '${selectedSessionIdentity.externalSessionId}' requires role and task context to read runtime todos.`,
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
    todosRef: toRuntimeSessionContextRef(repoPath, selectedSessionIdentity, runtimePolicy),
  };
};

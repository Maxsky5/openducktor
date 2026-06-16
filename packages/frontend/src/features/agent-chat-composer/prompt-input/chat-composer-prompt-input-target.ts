import type { RuntimeKind } from "@openducktor/contracts";
import type { RuntimeWorkingDirectoryRef } from "@openducktor/core";
import { getAgentSessionActivityStateFromSession } from "@/lib/agent-session-activity-state";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { resolveRuntimeWorkingDirectoryRefState } from "@/state/operations/agent-orchestrator/support/session-runtime-ref";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";

export type ChatComposerPromptInputTarget =
  | {
      kind: "session";
      runtimeRef: RuntimeWorkingDirectoryRef;
    }
  | {
      kind: "sessionLoading";
      runtimeKind: RuntimeKind | null;
    }
  | {
      kind: "unavailable";
      runtimeKind: RuntimeKind | null;
      error: string;
    }
  | {
      kind: "repo";
      repoPath: string;
      runtimeKind: RuntimeKind;
    }
  | {
      kind: "noRepo";
    }
  | {
      kind: "noRuntime";
      repoPath: string;
    };

type ResolveChatComposerPromptInputTargetArgs = {
  workspaceRepoPath: string | null;
  activeSession: ChatComposerPromptInputSession | null;
  selectedSessionIdentity: AgentSessionIdentity | null;
  selectedRuntimeKind: RuntimeKind | null;
};

type ChatComposerPromptInputSession = Pick<
  AgentSessionState,
  | "externalSessionId"
  | "runtimeKind"
  | "workingDirectory"
  | "status"
  | "pendingApprovals"
  | "pendingQuestions"
>;

export const resolveChatComposerPromptInputTarget = ({
  workspaceRepoPath,
  activeSession,
  selectedSessionIdentity,
  selectedRuntimeKind,
}: ResolveChatComposerPromptInputTargetArgs): ChatComposerPromptInputTarget => {
  if (activeSession) {
    const sessionIdentity = toAgentSessionIdentity(activeSession);
    const runtimeKind = sessionIdentity.runtimeKind;
    const activityState = getAgentSessionActivityStateFromSession(activeSession);
    if (activityState === "starting") {
      return {
        kind: "sessionLoading",
        runtimeKind,
      };
    }

    const { runtimeRef, runtimeRefError } = resolveRuntimeWorkingDirectoryRefState({
      repoPath: workspaceRepoPath,
      session: sessionIdentity,
    });
    if (runtimeRefError) {
      return {
        kind: "unavailable",
        runtimeKind,
        error: runtimeRefError,
      };
    }
    if (!runtimeRef) {
      return {
        kind: "sessionLoading",
        runtimeKind,
      };
    }
    return {
      kind: "session",
      runtimeRef,
    };
  }

  if (selectedSessionIdentity) {
    return {
      kind: "sessionLoading",
      runtimeKind: selectedSessionIdentity.runtimeKind,
    };
  }

  if (!workspaceRepoPath) {
    return { kind: "noRepo" };
  }
  if (!selectedRuntimeKind) {
    return {
      kind: "noRuntime",
      repoPath: workspaceRepoPath,
    };
  }
  return {
    kind: "repo",
    repoPath: workspaceRepoPath,
    runtimeKind: selectedRuntimeKind,
  };
};

export const getChatComposerPromptInputRuntimeKind = (
  target: ChatComposerPromptInputTarget,
): RuntimeKind | null => {
  switch (target.kind) {
    case "session":
      return target.runtimeRef.runtimeKind;
    case "sessionLoading":
    case "unavailable":
      return target.runtimeKind;
    case "repo":
      return target.runtimeKind;
    case "noRepo":
    case "noRuntime":
      return null;
  }
};

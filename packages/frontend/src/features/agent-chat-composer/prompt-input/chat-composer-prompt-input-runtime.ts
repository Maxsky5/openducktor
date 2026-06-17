import type { RuntimeKind } from "@openducktor/contracts";
import type { RuntimeWorkingDirectoryRef } from "@openducktor/core";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-health";
import { toRuntimeWorkingDirectoryRef } from "@/state/operations/agent-orchestrator/support/session-runtime-ref";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

export type ChatComposerPromptInputRuntime =
  | {
      state: "available";
      scope: "session" | "repo";
      runtimeRef: RuntimeWorkingDirectoryRef;
    }
  | {
      state: "waiting";
      runtimeKind: RuntimeKind | null;
      message: string;
    }
  | {
      state: "unavailable";
      runtimeKind: RuntimeKind | null;
      error: string;
    };

type ResolveChatComposerPromptInputRuntimeArgs = {
  workspaceRepoPath: string | null;
  selectedSessionIdentity: AgentSessionIdentity | null;
  repoReadinessState: RepoRuntimeReadinessState;
  selectedRuntimeKind: RuntimeKind | null;
};

const runtimeWaitingMessage = "File search is unavailable until the runtime is ready.";

export const resolveChatComposerPromptInputRuntime = ({
  workspaceRepoPath,
  selectedSessionIdentity,
  repoReadinessState,
  selectedRuntimeKind,
}: ResolveChatComposerPromptInputRuntimeArgs): ChatComposerPromptInputRuntime => {
  if (selectedSessionIdentity) {
    const runtimeKind = selectedSessionIdentity.runtimeKind;
    if (!workspaceRepoPath) {
      return {
        state: "unavailable",
        runtimeKind,
        error: "Repository path is required to read selected session runtime data.",
      };
    }
    if (repoReadinessState !== "ready") {
      return {
        state: "waiting",
        runtimeKind,
        message: runtimeWaitingMessage,
      };
    }

    return {
      state: "available",
      scope: "session",
      runtimeRef: toRuntimeWorkingDirectoryRef({
        repoPath: workspaceRepoPath,
        runtimeKind: selectedSessionIdentity.runtimeKind,
        workingDirectory: selectedSessionIdentity.workingDirectory,
        action: "read selected session runtime data",
      }),
    };
  }

  if (!workspaceRepoPath) {
    return {
      state: "unavailable",
      runtimeKind: null,
      error: "No repository selected.",
    };
  }
  if (!selectedRuntimeKind) {
    return {
      state: "unavailable",
      runtimeKind: null,
      error: "Select a runtime before using prompt input.",
    };
  }
  if (repoReadinessState !== "ready") {
    return {
      state: "waiting",
      runtimeKind: selectedRuntimeKind,
      message: runtimeWaitingMessage,
    };
  }
  return {
    state: "available",
    scope: "repo",
    runtimeRef: toRuntimeWorkingDirectoryRef({
      repoPath: workspaceRepoPath,
      runtimeKind: selectedRuntimeKind,
      workingDirectory: workspaceRepoPath,
      action: "read repo runtime data",
    }),
  };
};

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

export type ChatComposerPromptInputRuntimeSource =
  | { kind: "repo"; runtimeKind: RuntimeKind | null }
  | { kind: "session"; session: AgentSessionIdentity };

type ResolveChatComposerPromptInputRuntimeArgs = {
  workspaceRepoPath: string | null;
  repoReadinessState: RepoRuntimeReadinessState;
  source: ChatComposerPromptInputRuntimeSource;
};

const runtimeWaitingMessage = "File search is unavailable until the runtime is ready.";

export const resolveChatComposerPromptInputRuntime = ({
  workspaceRepoPath,
  repoReadinessState,
  source,
}: ResolveChatComposerPromptInputRuntimeArgs): ChatComposerPromptInputRuntime => {
  if (source.kind === "session") {
    const runtimeKind = source.session.runtimeKind;
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
    const session = source.session;

    return {
      state: "available",
      scope: "session",
      runtimeRef: toRuntimeWorkingDirectoryRef({
        repoPath: workspaceRepoPath,
        runtimeKind: session.runtimeKind,
        workingDirectory: session.workingDirectory,
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
  if (!source.runtimeKind) {
    return {
      state: "unavailable",
      runtimeKind: null,
      error: "Select a runtime before using prompt input.",
    };
  }
  if (repoReadinessState !== "ready") {
    return {
      state: "waiting",
      runtimeKind: source.runtimeKind,
      message: runtimeWaitingMessage,
    };
  }
  return {
    state: "available",
    scope: "repo",
    runtimeRef: toRuntimeWorkingDirectoryRef({
      repoPath: workspaceRepoPath,
      runtimeKind: source.runtimeKind,
      workingDirectory: workspaceRepoPath,
      action: "read repo runtime data",
    }),
  };
};

import { buildGitConflictAssistancePrompt } from "@openducktor/core";
import type { GitConflict } from "@/features/agent-studio-git";
import type { AgentMessageSendReceipt } from "@/types/agent-orchestrator";

export class GitConflictRequestCancelled extends Error {
  constructor() {
    super(
      "The selected chat or conflict directory changed. Ask for assistance again in the current chat.",
    );
    this.name = "GitConflictRequestCancelled";
  }
}

export type GitConflictAssistanceResult = AgentMessageSendReceipt | false;
export type ResolveGitConflict = (
  conflict: GitConflict,
  assertCurrent?: () => void,
) => Promise<GitConflictAssistanceResult>;

export const conflictRequestContext = (conflict: GitConflict) => {
  if (!conflict.operation || !conflict.workingDir?.trim())
    throw new Error(
      "Restore the Git conflict operation and working directory before asking for assistance.",
    );
  return {
    operation: conflict.operation,
    workingDirectory: conflict.workingDir,
    currentBranch: conflict.currentBranch,
    targetBranch: conflict.targetBranch || null,
    conflictedFiles: conflict.conflictedFiles,
    conflictOutput: conflict.output || null,
  };
};

export const buildWorkspaceConflictPrompt = (conflict: GitConflict): string =>
  buildGitConflictAssistancePrompt({ git: conflictRequestContext(conflict) });

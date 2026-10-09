import { GitCommitHorizontal } from "lucide-react";
import { memo, type ReactElement, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type CommitComposerProps = {
  hasUncommittedFiles: boolean;
  uncommittedFileCount: number;
  isCommitting: boolean;
  isPushing: boolean;
  isRebasing: boolean;
  isResetting: boolean;
  isGitActionsLocked: boolean;
  gitActionsLockReason: string | null;
  commitError: string | null;
  commitAll: ((message: string) => Promise<boolean>) | null;
};

export const CommitComposer = memo(function CommitComposer({
  hasUncommittedFiles,
  uncommittedFileCount,
  isCommitting,
  isPushing,
  isRebasing,
  isResetting,
  isGitActionsLocked,
  gitActionsLockReason,
  commitError,
  commitAll,
}: CommitComposerProps): ReactElement {
  const [commitMessage, setCommitMessage] = useState("");
  const placeholder = getPlaceholder(isGitActionsLocked, gitActionsLockReason, hasUncommittedFiles);
  const isAnyActionInFlight = isCommitting || isPushing || isRebasing || isResetting;
  const canWrite = commitAll != null && !isAnyActionInFlight && !isGitActionsLocked;
  const canCommit = canWrite && hasUncommittedFiles && commitMessage.trim().length > 0;

  const handleCommitSubmit = async (): Promise<void> => {
    if (!canCommit || commitAll == null) {
      return;
    }
    const wasCommitted = await commitAll(commitMessage);
    if (wasCommitted) {
      setCommitMessage("");
    }
  };

  return (
    <div
      className="space-y-2 border-t border-border bg-card p-3"
      data-testid="agent-studio-git-commit-form"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">Commit all changes</p>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {uncommittedFileCount} file{uncommittedFileCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex items-end gap-2">
        <Textarea
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.currentTarget.value)}
          placeholder={placeholder}
          aria-label="Commit message"
          rows={2}
          className="min-h-14 min-w-0 flex-1 resize-none border-input text-xs"
          disabled={!canWrite}
          data-testid="agent-studio-git-commit-message-input"
        />

        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0 gap-1.5 text-xs disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
          onClick={() => void handleCommitSubmit()}
          disabled={!canCommit}
          data-testid="agent-studio-git-commit-submit-button"
        >
          <GitCommitHorizontal className="size-3.5" />
          {isCommitting ? "Committing..." : "Commit all"}
        </Button>
      </div>
      {isGitActionsLocked ? (
        <p className="text-[11px] text-muted-foreground">
          {gitActionsLockReason ?? "Git actions are disabled."}
        </p>
      ) : null}

      {commitError ? (
        <p
          className="text-xs text-destructive-surface-foreground"
          data-testid="agent-studio-git-commit-error"
        >
          {commitError}
        </p>
      ) : null}
    </div>
  );
});

function getPlaceholder(
  isGitActionsLocked: boolean,
  gitActionsLockReason: string | null,
  hasUncommittedFiles: boolean,
): string {
  if (isGitActionsLocked) return gitActionsLockReason ?? "Git actions are disabled.";
  return hasUncommittedFiles ? "Describe what changed and why" : "No uncommitted files to commit";
}

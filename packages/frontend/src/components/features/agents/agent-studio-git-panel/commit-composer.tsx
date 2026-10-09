import { Send } from "lucide-react";
import { memo, type ReactElement, useState } from "react";
import { Badge } from "@/components/ui/badge";
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
  const copy = getCopy(isGitActionsLocked, gitActionsLockReason, hasUncommittedFiles);
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
      className="space-y-3 border-t border-sidebar-border bg-sidebar p-3"
      data-testid="agent-studio-git-commit-form"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-sidebar-foreground">Commit all changes</p>
          <p className="text-[11px] text-sidebar-foreground/70">
            One message for every uncommitted file in this workspace.
          </p>
        </div>
        <Badge variant="outline" className="px-2 py-0.5 text-[10px]">
          {uncommittedFileCount} file{uncommittedFileCount === 1 ? "" : "s"}
        </Badge>
      </div>

      <Textarea
        value={commitMessage}
        onChange={(event) => setCommitMessage(event.currentTarget.value)}
        placeholder={copy.placeholder}
        className="min-h-20 resize-none border-input"
        disabled={!canWrite}
        data-testid="agent-studio-git-commit-message-input"
      />

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-sidebar-foreground/70">{copy.hint}</p>
        <Button
          type="button"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => void handleCommitSubmit()}
          disabled={!canCommit}
          data-testid="agent-studio-git-commit-submit-button"
        >
          <Send className="size-3.5" />
          {isCommitting ? "Committing..." : "Commit all"}
        </Button>
      </div>

      {commitError ? (
        <p className="text-xs text-destructive" data-testid="agent-studio-git-commit-error">
          {commitError}
        </p>
      ) : null}
    </div>
  );
});

function getCopy(
  isGitActionsLocked: boolean,
  gitActionsLockReason: string | null,
  hasUncommittedFiles: boolean,
) {
  if (isGitActionsLocked) {
    const reason = gitActionsLockReason ?? "Git actions are disabled.";
    return { placeholder: reason, hint: reason };
  }
  if (hasUncommittedFiles) {
    return {
      placeholder: "Describe what changed and why",
      hint: "This action commits all listed changes in one go.",
    };
  }
  return {
    placeholder: "No uncommitted files to commit",
    hint: "Make a change first, then write a commit message.",
  };
}

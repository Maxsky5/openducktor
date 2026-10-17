import { GitCommitHorizontal, LoaderCircle } from "lucide-react";
import { type KeyboardEvent, memo, type ReactElement, useId } from "react";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { GitCommitMode } from "@/features/agent-studio-git";
import { isApplePlatform } from "@/lib/steer-shortcut";
import { cn } from "@/lib/utils";
import {
  clearSubmittedCommitMessage,
  useGitPanelViewField,
  useGitPanelViewUpdate,
} from "./git-panel-view-store";

export type CommitComposerProps = {
  /** The Git context that owns the draft. */
  contextKey: string;
  stagedFileCount: number;
  changedFileCount: number;
  hasConflicts: boolean;
  committingMode: GitCommitMode | null;
  /** Why no Git write can start now, or null when one can. */
  blockedReason: string | null;
  commitError: string | null;
  commit: ((mode: GitCommitMode, message: string) => Promise<boolean>) | null;
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The announced status of a running commit, by mode. */
const PENDING_STATUS = {
  staged: "Committing staged changes",
  all: "Committing all changes",
} satisfies Record<GitCommitMode, string>;

/**
 * One line: the message and the Commit button. Enter commits the staged changes, and Cmd or Ctrl
 * with Enter stages every change and commits it.
 */
export const CommitComposer = memo(function CommitComposer({
  contextKey,
  stagedFileCount,
  changedFileCount,
  hasConflicts,
  committingMode,
  blockedReason,
  commitError,
  commit,
}: CommitComposerProps): ReactElement {
  // The composer reads only its draft, so other view changes do not render it.
  const message = useGitPanelViewField(contextKey, "commitMessage");
  const updateView = useGitPanelViewUpdate(contextKey);
  const hintId = `${useId()}-hint`;
  const isCommitting = committingMode !== null;
  const modifier = isApplePlatform() ? "⌘" : "Ctrl";
  const input: CommitInput = {
    canCommit: commit !== null && !isCommitting,
    blockedReason,
    message,
    hasConflicts,
    stagedFileCount,
    changedFileCount,
    modifier,
  };
  const reasons = {
    staged: commitBlockedReason("staged", input),
    all: commitBlockedReason("all", input),
  } satisfies Record<GitCommitMode, string | null>;

  const submit = async (mode: GitCommitMode): Promise<void> => {
    if (reasons[mode] !== null || !commit) return;
    const submitted = message;
    if (await commit(mode, submitted)) clearSubmittedCommitMessage(contextKey, submitted);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    // Enter also confirms text from an input method. That must not commit.
    if (event.nativeEvent.isComposing || event.key !== "Enter") return;
    event.preventDefault();
    void submit(event.metaKey || event.ctrlKey ? "all" : "staged");
  };

  return (
    <div
      className="shrink-0 border-t border-border px-2 py-2"
      data-testid="agent-studio-git-commit-form"
    >
      <div
        // One input group: the field and the Commit button share one border, height, and focus.
        className="flex h-8 min-w-0 items-stretch overflow-hidden rounded-md border border-input bg-card shadow-sm transition-colors has-[input:focus-visible]:border-ring"
        data-testid="agent-studio-git-commit-input-group"
      >
        <Input
          embedded
          value={message}
          disabled={isCommitting || commit === null}
          placeholder={`Commit message (${modifier}+Enter commits all)`}
          aria-label="Commit message"
          aria-describedby={hintId}
          className="h-full min-w-0 flex-1 px-2.5 text-xs"
          data-testid="agent-studio-git-commit-message-input"
          onKeyDown={onKeyDown}
          onChange={(event) => {
            const commitMessage = event.currentTarget.value;
            updateView(() => ({ commitMessage }));
          }}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            {/* A disabled button gets no pointer events, so the wrapper shows its tooltip. */}
            <span className="flex shrink-0 border-l border-input">
              <button
                type="button"
                // A disabled Commit keeps the primary color, dimmed like every disabled button.
                className={cn(
                  "flex h-full w-9 cursor-pointer items-center justify-center bg-primary text-primary-foreground outline-none transition-colors",
                  "enabled:hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary-foreground/70 focus-visible:ring-inset",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
                aria-label="Commit staged changes"
                disabled={reasons.staged !== null}
                onClick={() => void submit("staged")}
                data-testid="agent-studio-git-commit-submit-button"
              >
                {isCommitting ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <GitCommitHorizontal className="size-4" />
                )}
              </button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" align="end">
            <p>{reasons.staged ?? `Commit ${plural(stagedFileCount, "staged file")}`}</p>
          </TooltipContent>
        </Tooltip>
      </div>
      <p id={hintId} className="sr-only" data-testid="agent-studio-git-commit-hint">
        {composerHint(input)}
      </p>
      <span role="status" className="sr-only" data-testid="agent-studio-git-commit-status">
        {committingMode ? PENDING_STATUS[committingMode] : ""}
      </span>
      {commitError ? (
        <p
          role="alert"
          className="mt-1.5 px-0.5 text-xs text-destructive"
          data-testid="agent-studio-git-commit-error"
        >
          {commitError}
        </p>
      ) : null}
    </div>
  );
});

type CommitInput = {
  /** False while a commit runs or when the panel cannot commit. */
  canCommit: boolean;
  blockedReason: string | null;
  message: string;
  hasConflicts: boolean;
  stagedFileCount: number;
  changedFileCount: number;
  /** The key that commits all changes with Enter: ⌘ or Ctrl. */
  modifier: string;
};

/** Why a commit of `mode` cannot start now, or null when it can. */
function commitBlockedReason(mode: GitCommitMode, input: CommitInput): string | null {
  if (input.blockedReason) return input.blockedReason;
  if (!input.canCommit) return "Wait for the current commit to finish.";
  // Git records no commit while a path is unmerged, in either mode.
  if (input.hasConflicts) return "Resolve the conflicted files first.";
  if (mode === "staged" && input.stagedFileCount === 0) {
    return input.changedFileCount > 0
      ? `Nothing is staged. Stage files, or press ${input.modifier}+Enter to commit all changes.`
      : "Nothing is staged.";
  }
  if (mode === "all" && input.changedFileCount === 0) return "No changes to commit.";
  if (input.message.trim().length === 0) return "Write a commit message.";
  return null;
}

/** The screen reader description of the field. */
function composerHint(input: CommitInput): string {
  if (input.blockedReason) return input.blockedReason;
  if (input.hasConflicts) return "Resolve the conflicted files before you commit.";
  const all = `${input.modifier}+Enter stages and commits all ${plural(input.changedFileCount, "changed file")}.`;
  if (input.stagedFileCount > 0) {
    return `Enter commits ${plural(input.stagedFileCount, "staged file")}. ${all}`;
  }
  if (input.changedFileCount > 0) return `Nothing is staged. ${all}`;
  return "No changes to commit.";
}

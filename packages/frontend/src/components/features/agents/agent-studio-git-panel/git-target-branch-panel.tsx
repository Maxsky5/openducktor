import { LoaderCircle, Pencil, Target, X } from "lucide-react";
import { type ReactElement, useRef, useState } from "react";
import { BranchSelector } from "@/components/features/repository/branch-selector";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import type { AgentStudioGitPanelModel } from "./types";

const TARGET_BRANCH_LABEL_ID = "agent-studio-git-target-branch-label";

type EditorState =
  | { mode: "display" }
  | {
      mode: "editing";
      draft: string;
      isSaving: boolean;
      error?: string;
    };

export type GitTargetBranchPanelProps = {
  control: Pick<
    AgentStudioGitPanelModel,
    "targetBranchHelpText" | "targetBranchesPending" | "targetBranchesError" | "retryTargetBranches"
  >;
  canEditTargetBranch: boolean;
  targetBranchLabel: string;
  targetBranchOptions: NonNullable<AgentStudioGitPanelModel["targetBranchOptions"]>;
  targetBranchSelectionValue: string;
  onUpdateTargetBranch: AgentStudioGitPanelModel["onUpdateTargetBranch"];
};

export function GitTargetBranchPanel({
  control,
  canEditTargetBranch,
  targetBranchLabel,
  targetBranchOptions,
  targetBranchSelectionValue,
  onUpdateTargetBranch,
}: GitTargetBranchPanelProps): ReactElement {
  const [editor, setEditor] = useState<EditorState>({ mode: "display" });
  // Block a second selection before React renders the saving state.
  const saving = useRef(false);
  const isEditing = canEditTargetBranch && editor.mode === "editing";
  const isSaving = isEditing ? editor.isSaving : false;
  const value = isEditing ? editor.draft : targetBranchSelectionValue;

  const edit = (): void => {
    if (!canEditTargetBranch || isSaving) {
      return;
    }

    setEditor({
      mode: "editing",
      draft: targetBranchSelectionValue,
      isSaving: false,
    });
  };

  const cancel = (): void => {
    if (isSaving) {
      return;
    }

    setEditor({ mode: "display" });
  };

  const select = (selection: string): void => {
    if (!onUpdateTargetBranch || editor.mode !== "editing" || saving.current) {
      return;
    }

    if (selection === targetBranchSelectionValue) {
      setEditor({ mode: "display" });
      return;
    }

    saving.current = true;
    setEditor({
      mode: "editing",
      draft: selection,
      isSaving: true,
    });

    void onUpdateTargetBranch(selection).then(
      () => {
        saving.current = false;
        setEditor({ mode: "display" });
      },
      (error) => {
        saving.current = false;
        setEditor({
          mode: "editing",
          draft: selection,
          isSaving: false,
          error: errorMessage(error),
        });
      },
    );
  };

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p
        id={TARGET_BRANCH_LABEL_ID}
        className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase"
      >
        Target branch
      </p>
      {isEditing ? (
        <div
          className="mt-1 flex h-7 min-w-0 items-center gap-2"
          data-testid="agent-studio-git-target-branch-editor"
        >
          <div className="min-w-0 flex-1">
            <BranchSelector
              value={value}
              options={targetBranchOptions}
              triggerAriaLabelledBy={TARGET_BRANCH_LABEL_ID}
              className="w-full"
              popoverClassName="w-[min(28rem,calc(100vw-2rem))] p-0"
              triggerClassName="h-7 text-xs"
              disabled={isSaving || control.targetBranchesPending || !!control.targetBranchesError}
              onValueChange={select}
            />
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label="Cancel target branch edit"
            onClick={cancel}
            disabled={isSaving}
            data-testid="agent-studio-git-target-branch-cancel"
          >
            {isSaving ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <X className="size-3.5" />
            )}
          </Button>
        </div>
      ) : (
        <div
          className="mt-1 flex h-7 min-w-0 items-center gap-1.5"
          data-testid="agent-studio-git-target-branch-display-row"
        >
          <Target className="size-3.5 shrink-0 text-muted-foreground" />
          <span
            className="min-w-0 flex-1 truncate font-mono text-xs text-foreground"
            data-testid="agent-studio-git-target-branch"
          >
            {targetBranchLabel}
          </span>
          {canEditTargetBranch ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="ml-auto size-7 shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Edit target branch"
              onClick={edit}
              data-testid="agent-studio-git-target-branch-edit"
            >
              <Pencil className="size-3.5" />
            </Button>
          ) : null}
        </div>
      )}
      {control.targetBranchHelpText ? (
        <p className="mt-2 text-xs text-muted-foreground">{control.targetBranchHelpText}</p>
      ) : null}
      {control.targetBranchesPending ? (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          Loading comparison branches...
        </p>
      ) : null}
      {control.targetBranchesError ? (
        <div role="alert" className="mt-2 text-xs text-destructive">
          {control.targetBranchesError}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void control.retryTargetBranches?.().catch(() => {})}
          >
            Retry branches
          </Button>
        </div>
      ) : null}
      {editor.mode === "editing" && editor.error ? (
        <div role="alert" className="mt-2 text-xs text-destructive">
          {editor.error}
          <Button
            variant="outline"
            size="sm"
            disabled={isSaving}
            onClick={() => select(editor.draft)}
          >
            Retry selection
          </Button>
        </div>
      ) : null}
    </div>
  );
}

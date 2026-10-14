import { ChevronDown, LoaderCircle, Target } from "lucide-react";
import { type ReactElement, useId, useLayoutEffect, useRef, useState } from "react";
import { BranchSelector } from "@/components/features/repository/branch-selector";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import {
  BRANCH_CHIP_BUTTON_CLASS_NAME,
  BRANCH_CHIP_CLASS_NAME,
} from "@/components/features/repository/branch-chip-classnames";
import type { AgentStudioGitPanelModel } from "./types";

type EditorState = { context: string } & (
  | { mode: "display" }
  | {
      mode: "editing";
      draft: string;
      isSaving: boolean;
      error?: string;
    }
);

export type GitTargetBranchSelectorProps = {
  branch: string;
  control: Pick<
    AgentStudioGitPanelModel,
    "targetBranchHelpText" | "targetBranchesPending" | "targetBranchesError" | "retryTargetBranches"
  >;
  targetBranchLabel: string;
  targetBranchOptions: NonNullable<AgentStudioGitPanelModel["targetBranchOptions"]>;
  targetBranchSelectionValue: string;
  onUpdateTargetBranch: AgentStudioGitPanelModel["onUpdateTargetBranch"];
};

function TargetChipContent({ label, labelId }: { label: string; labelId?: string }): ReactElement {
  return (
    <>
      <Target className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span id={labelId} className="sr-only">
        Target branch:
      </span>
      <span className="min-w-0 truncate" data-testid="agent-studio-git-target-branch">
        {label}
      </span>
    </>
  );
}

/** The target branch when the panel cannot change it. */
export function GitTargetBranchChip({ label }: { label: string }): ReactElement {
  return (
    <span
      className={cn(BRANCH_CHIP_CLASS_NAME, "cursor-default")}
      title={`Compare with: ${label}`}
      data-testid="agent-studio-git-target-branch-display-row"
    >
      <TargetChipContent label={label} />
    </span>
  );
}

/** The target branch as a chip that opens the branch list to choose another target. */
export function GitTargetBranchSelector({
  branch,
  control,
  targetBranchLabel,
  targetBranchOptions,
  targetBranchSelectionValue,
  onUpdateTargetBranch,
}: GitTargetBranchSelectorProps): ReactElement {
  const labelId = useId();
  const context = JSON.stringify([branch, targetBranchSelectionValue]);
  const [editor, setEditor] = useState<EditorState>({
    context,
    mode: "display",
  });
  // Close edits when their branch or target changes.
  if (editor.context !== context) {
    setEditor({ context, mode: "display" });
  }
  // Block a second selection before React renders the saving state.
  const saving = useRef<EditorState | null>(null);
  useLayoutEffect(() => {
    if (saving.current?.context !== context) saving.current = null;
  }, [context]);
  const isEditing = editor.context === context && editor.mode === "editing";
  const isSaving = isEditing ? editor.isSaving : false;
  const value = isEditing ? editor.draft : targetBranchSelectionValue;
  const disableOptions =
    isSaving || Boolean(control.targetBranchesPending || control.targetBranchesError);
  const options = targetBranchOptions
    .toSorted((left, right) => Number(right.value === value) - Number(left.value === value))
    .map((option) => ({
      ...option,
      disabled: disableOptions || option.disabled === true,
    }));
  const setOpen = (open: boolean): void => {
    if (saving.current?.context === context) {
      return;
    }

    setEditor(
      open
        ? { context, mode: "editing", draft: targetBranchSelectionValue, isSaving: false }
        : { context, mode: "display" },
    );
  };

  const select = (selection: string): void => {
    if (!onUpdateTargetBranch || editor.mode !== "editing" || saving.current?.context === context) {
      return;
    }

    if (selection === targetBranchSelectionValue) {
      setEditor({ context, mode: "display" });
      return;
    }

    const pending: EditorState = {
      context,
      mode: "editing",
      draft: selection,
      isSaving: true,
    };
    saving.current = pending;
    setEditor(pending);

    void onUpdateTargetBranch(selection).then(
      () => {
        if (saving.current === pending) saving.current = null;
        setEditor((current) =>
          current === pending ? { context: current.context, mode: "display" } : current,
        );
      },
      (error) => {
        if (saving.current === pending) saving.current = null;
        // Do not show a result after another target replaced this edit.
        setEditor((current) =>
          current === pending
            ? { ...pending, isSaving: false, error: errorMessage(error) }
            : current,
        );
      },
    );
  };

  return (
    <BranchSelector
      value={value}
      options={options}
      open={isEditing}
      onOpenChange={setOpen}
      onValueChange={select}
      disabled={isSaving}
      triggerAriaLabelledBy={labelId}
      className="min-w-0 max-w-full"
      popoverClassName="w-[min(20rem,calc(100vw-1rem))] p-0 [&_[data-slot=command-list]]:max-h-48"
      trigger={
        <button
          type="button"
          className={cn(BRANCH_CHIP_CLASS_NAME, BRANCH_CHIP_BUTTON_CLASS_NAME)}
          title={`Compare with: ${targetBranchLabel}. Choose another target branch.`}
          aria-label={`Target branch: ${targetBranchLabel}. Choose another target branch.`}
          disabled={isSaving}
          data-testid="agent-studio-git-target-branch-edit"
        >
          <TargetChipContent label={targetBranchLabel} labelId={labelId} />
          {isSaving ? (
            <LoaderCircle className="size-3 shrink-0 animate-spin" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden="true" />
          )}
        </button>
      }
      footer={
        isEditing ? (
          <GitTargetBranchEditorHelp
            control={control}
            editor={editor}
            select={select}
            cancel={() => setOpen(false)}
          />
        ) : null
      }
    />
  );
}

function GitTargetBranchEditorHelp({
  control,
  editor,
  select,
  cancel,
}: {
  control: GitTargetBranchSelectorProps["control"];
  editor: Extract<EditorState, { mode: "editing" }> | null;
  select: (value: string) => void;
  cancel: () => void;
}): ReactElement {
  const isSaving = editor?.isSaving ?? false;
  return (
    <div className="space-y-2 border-t border-border p-3">
      {control.targetBranchHelpText ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {control.targetBranchHelpText}
        </p>
      ) : null}
      {control.targetBranchesPending || isSaving ? (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3 animate-spin" />
          {isSaving ? "Applying comparison..." : "Loading comparison branches..."}
        </p>
      ) : null}
      {control.targetBranchesError ? (
        <div role="alert" className="space-y-2 text-xs text-destructive">
          <p>{control.targetBranchesError}</p>
          <Button
            variant="outline"
            size="sm"
            disabled={isSaving}
            onClick={() => void control.retryTargetBranches?.().catch(() => {})}
          >
            Retry branches
          </Button>
        </div>
      ) : null}
      {editor?.error ? (
        <div role="alert" className="space-y-2 text-xs text-destructive">
          <p>{editor.error}</p>
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
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 w-full text-xs"
        aria-label="Cancel target branch edit"
        disabled={isSaving}
        onClick={cancel}
        data-testid="agent-studio-git-target-branch-cancel"
      >
        Cancel
      </Button>
    </div>
  );
}

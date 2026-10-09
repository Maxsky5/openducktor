import { LoaderCircle, Pencil, Target, X } from "lucide-react";
import { type ReactElement, useEffect, useId, useRef, useState } from "react";
import { BranchSelector } from "@/components/features/repository/branch-selector";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
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

export type GitTargetBranchControlProps = {
  branch: string;
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

export function GitTargetBranchControl({
  branch,
  control,
  canEditTargetBranch,
  targetBranchLabel,
  targetBranchOptions,
  targetBranchSelectionValue,
  onUpdateTargetBranch,
}: GitTargetBranchControlProps): ReactElement {
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
  const saving = useRef(false);
  const isEditing = canEditTargetBranch && editor.context === context && editor.mode === "editing";
  const isSaving = isEditing ? editor.isSaving : false;
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !isEditing) editButton.current?.focus();
    wasEditing.current = isEditing;
  }, [isEditing]);
  const value = isEditing ? editor.draft : targetBranchSelectionValue;
  const disableOptions =
    isSaving || Boolean(control.targetBranchesPending || control.targetBranchesError);
  const options = targetBranchOptions
    .toSorted((left, right) => Number(right.value === value) - Number(left.value === value))
    .map((option) => ({
      ...option,
      disabled: disableOptions || option.disabled === true,
    }));
  const label =
    value === targetBranchSelectionValue
      ? targetBranchLabel
      : (options.find((option) => option.value === value)?.label ?? targetBranchLabel);

  const edit = (): void => {
    if (!canEditTargetBranch || saving.current) {
      return;
    }

    setEditor({
      context,
      mode: "editing",
      draft: targetBranchSelectionValue,
      isSaving: false,
    });
  };

  const cancel = (): void => {
    if (saving.current) {
      return;
    }

    setEditor({ context, mode: "display" });
  };

  const select = (selection: string): void => {
    if (!onUpdateTargetBranch || editor.mode !== "editing" || saving.current) {
      return;
    }

    if (selection === targetBranchSelectionValue) {
      setEditor({ context, mode: "display" });
      return;
    }

    saving.current = true;
    const pending: EditorState = {
      context,
      mode: "editing",
      draft: selection,
      isSaving: true,
    };
    setEditor(pending);

    void onUpdateTargetBranch(selection).then(
      () => {
        saving.current = false;
        setEditor((current) =>
          current === pending ? { context: current.context, mode: "display" } : current,
        );
      },
      (error) => {
        saving.current = false;
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
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p
        id={labelId}
        className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase"
      >
        Target branch
      </p>
      {isEditing ? (
        <>
          <div
            className="mt-1 flex h-7 min-w-0 items-center gap-2"
            data-testid="agent-studio-git-target-branch-editor"
          >
            <div className="min-w-0 flex-1">
              <BranchSelector
                value={value}
                options={options}
                triggerAriaLabelledBy={labelId}
                className="w-full"
                popoverClassName="w-[min(28rem,calc(100vw-2rem))] p-0"
                triggerClassName="h-7 text-xs"
                disabled={isSaving}
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
          <GitTargetBranchEditorHelp control={control} editor={editor} select={select} />
        </>
      ) : (
        <div
          className="mt-1 flex h-7 min-w-0 items-center gap-1.5"
          data-testid="agent-studio-git-target-branch-display-row"
        >
          <Target className="size-3.5 shrink-0 text-muted-foreground" />
          <span
            className="min-w-0 flex-1 truncate font-mono text-xs text-foreground"
            title={`Compare with: ${label}`}
            data-testid="agent-studio-git-target-branch"
          >
            {label}
          </span>
          {canEditTargetBranch ? (
            <Button
              ref={editButton}
              type="button"
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label="Edit target branch"
              onClick={edit}
              data-testid="agent-studio-git-target-branch-edit"
            >
              <Pencil className="size-3.5" />
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function GitTargetBranchEditorHelp({
  control,
  editor,
  select,
}: {
  control: GitTargetBranchControlProps["control"];
  editor: Extract<EditorState, { mode: "editing" }> | null;
  select: (value: string) => void;
}): ReactElement {
  const isSaving = editor?.isSaving ?? false;
  return (
    <div className="mt-2 space-y-2">
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
    </div>
  );
}

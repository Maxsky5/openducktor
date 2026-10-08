import { LoaderCircle, Pencil, X } from "lucide-react";
import { type ReactElement, useId, useRef, useState } from "react";
import { Combobox } from "@/components/ui/combobox";
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
  // Keep the trigger mounted for focus, but close edits when their branch or target changes.
  if (editor.context !== context) {
    setEditor({ context, mode: "display" });
  }
  // Block a second selection before React renders the saving state.
  const saving = useRef(false);
  const isEditing = canEditTargetBranch && editor.context === context && editor.mode === "editing";
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
  const label = options.find((option) => option.value === value)?.label ?? targetBranchLabel;

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
    <div
      className="flex h-6 min-w-0 items-center gap-1"
      data-testid="agent-studio-git-target-branch-display-row"
    >
      <span id={labelId} className="sr-only">
        Edit target branch
      </span>
      <span
        className="min-w-0 truncate font-mono text-xs text-foreground"
        title={`Compare with: ${label}`}
        data-testid="agent-studio-git-target-branch"
      >
        {label}
      </span>
      {canEditTargetBranch ? (
        <Combobox
          value={value}
          options={options}
          placeholder={targetBranchLabel}
          open={isEditing}
          onOpenChange={(open) => (open ? edit() : cancel())}
          triggerAriaLabelledBy={labelId}
          trigger={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
              aria-labelledby={labelId}
              title="Change comparison branch"
              disabled={isSaving}
            >
              <Pencil className="size-3" />
            </Button>
          }
          className="w-[min(20rem,calc(100vw-1rem))] p-0 [&_[data-slot=command-list]]:max-h-48"
          searchPlaceholder="Find comparison branch..."
          wrapOptionLabels
          disabled={isSaving}
          onValueChange={select}
          footer={
            <GitTargetBranchMenuFooter
              control={control}
              editor={isEditing ? editor : null}
              cancel={cancel}
              select={select}
            />
          }
        />
      ) : null}
    </div>
  );
}

function GitTargetBranchMenuFooter({
  control,
  editor,
  cancel,
  select,
}: {
  control: GitTargetBranchControlProps["control"];
  editor: Extract<EditorState, { mode: "editing" }> | null;
  cancel: () => void;
  select: (value: string) => void;
}): ReactElement {
  const isSaving = editor?.isSaving ?? false;
  return (
    <div
      className="space-y-2 border-t border-border px-3 py-2"
      data-testid="agent-studio-git-target-branch-editor"
    >
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
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          Comparison only. Does not switch branches.
        </span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-6 shrink-0"
          aria-label="Cancel target branch edit"
          onClick={cancel}
          disabled={isSaving}
          data-testid="agent-studio-git-target-branch-cancel"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

import type { WorkflowTaskRef } from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { workflowTaskMovesQueryOptions } from "@openducktor/frontend-core/queries/workflow-library";
import { useQuery } from "@tanstack/react-query";
import { Loader2, type LucideIcon } from "lucide-react";
import { type ReactElement, type ReactNode, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { WORKFLOW_DIALOG } from "../../workflow-dialog";
import { useEditorState } from "../editor-context";
import { movableTasks, selectedMoves, TaskMovesList, taskRefKey } from "./task-moves-list";

type TaskMovesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowId: string;
  /** `draft` lists the moves of a publication, `latest` the moves to the latest version. */
  target: "draft" | "latest";
  title: string;
  description: ReactNode;
  confirmLabel: string;
  ConfirmIcon: LucideIcon;
  /** Runs the command. A rejection shows its message and keeps the dialog open. */
  onConfirm: (tasks: WorkflowTaskRef[]) => Promise<void>;
  /** A title over the task list, when other content comes before it. */
  movesTitle?: string;
  /** Content before the task list, such as the warnings of a publication. */
  children?: ReactNode;
  /** False when no task can be on an older version, such as at the first publication. */
  showMoves?: boolean;
};

/**
 * The tasks on older versions and the selection. Null keeps the first selection: every task
 * that can move. A disabled list reads as loaded and empty.
 */
const useTaskMoves = (workflowId: string, target: "draft" | "latest", enabled: boolean) => {
  const query = useQuery({ ...workflowTaskMovesQueryOptions(workflowId, target), enabled });
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null);
  const groups = query.data ?? [];
  const loading = enabled && query.isPending;
  return {
    groups,
    shown: selected ?? new Set(movableTasks(groups).map(taskRefKey)),
    select: setSelected,
    loading,
    loadError: query.isError ? errorMessage(query.error) : null,
    blocked: loading || (enabled && query.isError),
  };
};

/** Runs the command once at a time and keeps the message of a rejection. */
const useConfirm = (command: () => Promise<void>) => {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setPending(true);
    setError(null);
    try {
      await command();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };
  return { pending, error, confirm };
};

/** The title and the task list, or the reason that the list could not load. */
function MovesSection({
  title,
  loadError,
  groups,
  stateLabels,
  selected,
  disabled,
  onSelect,
}: {
  title: string | undefined;
  loadError: string | null;
  groups: Parameters<typeof TaskMovesList>[0]["groups"];
  stateLabels: ReadonlyMap<string, string>;
  selected: ReadonlySet<string>;
  disabled: boolean;
  onSelect: (selected: ReadonlySet<string>) => void;
}): ReactElement {
  return (
    <>
      {title ? <h3 className="-mb-2 text-sm font-semibold">{title}</h3> : null}
      {loadError ? (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : (
        <TaskMovesList
          groups={groups}
          stateLabels={stateLabels}
          selected={selected}
          disabled={disabled}
          onToggle={(task, on) => {
            const next = new Set(selected);
            if (on) next.add(taskRefKey(task));
            else next.delete(taskRefKey(task));
            onSelect(next);
          }}
        />
      )}
    </>
  );
}

/**
 * Lists the tasks of all repositories on older versions, grouped by repository. Tasks that can
 * move start selected. Tasks that cannot move show the reason.
 */
export function TaskMovesDialog({
  open,
  onOpenChange,
  workflowId,
  target,
  title,
  description,
  confirmLabel,
  ConfirmIcon,
  onConfirm,
  movesTitle,
  children,
  showMoves = true,
}: TaskMovesDialogProps): ReactElement {
  const moves = useTaskMoves(workflowId, target, open && showMoves);
  const states = useEditorState((state) => state.document.definition.states);
  const stateLabels = useMemo(() => new Map(states.map(({ id, label }) => [id, label])), [states]);
  const { pending, error, confirm } = useConfirm(() =>
    onConfirm(selectedMoves(moves.groups, moves.shown)),
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent
        className={WORKFLOW_DIALOG.lg}
        loading={moves.loading}
        loadingLabel="Reading the tasks on older versions"
      >
        <DialogHeader className={WORKFLOW_DIALOG.header}>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {showMoves || children || error ? (
          <DialogBody className={cn(WORKFLOW_DIALOG.body, "flex flex-col gap-4")}>
            {children}
            {showMoves ? (
              <MovesSection
                title={movesTitle}
                loadError={moves.loadError}
                groups={moves.groups}
                stateLabels={stateLabels}
                selected={moves.shown}
                disabled={pending}
                onSelect={moves.select}
              />
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </DialogBody>
        ) : null}
        <DialogFooter className={WORKFLOW_DIALOG.footer}>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={pending || moves.blocked} onClick={() => void confirm()}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ConfirmIcon className="size-4" />
            )}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

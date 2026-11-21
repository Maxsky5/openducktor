import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { plural } from "@openducktor/frontend-core/lib/plural";
import { workflowVersionsQueryOptions } from "@openducktor/frontend-core/queries/workflow-library";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpToLine, Eye } from "lucide-react";
import { type ReactElement, useState } from "react";
import { Link } from "react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useDialogPresence,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useMoveTasks } from "../../use-workflow-library-commands";
import { WORKFLOW_DIALOG } from "../../workflow-dialog";
import { workflowVersionPath } from "../../workflow-routes";
import { publishedAtText } from "../published-at";
import { TaskMovesDialog } from "./task-moves-dialog";

/** The published versions of a workflow, and the move of tasks to the latest version. */
export function VersionsDialog({
  open,
  onOpenChange,
  workflowId,
  latestVersion,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowId: string;
  latestVersion: number | null;
}): ReactElement {
  const query = useQuery({ ...workflowVersionsQueryOptions(workflowId), enabled: open });
  const moveTasks = useMoveTasks();
  const [moving, setMoving] = useState(false);
  const movesMounted = useDialogPresence(moving);
  const versions = [...(query.data ?? [])].sort((left, right) => right.version - left.version);
  const olderTasks = versions
    .filter(({ version }) => version !== latestVersion)
    .reduce((sum, { taskCount }) => sum + taskCount, 0);
  const moveBlocker =
    olderTasks === 0 ? "No task uses an older version, so no task can move." : undefined;
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={WORKFLOW_DIALOG.lg}
          loading={query.isPending}
          loadingLabel="Reading versions"
        >
          <DialogHeader className={WORKFLOW_DIALOG.header}>
            <DialogTitle>Versions</DialogTitle>
            <DialogDescription>
              A version never changes. New tasks use the latest version.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className={cn(WORKFLOW_DIALOG.body, "flex flex-col gap-3")}>
            {query.isError ? (
              <Alert variant="destructive">
                <AlertDescription>{errorMessage(query.error)}</AlertDescription>
              </Alert>
            ) : null}
            {versions.length === 0 && query.isSuccess ? (
              <p className="text-sm text-muted-foreground">The workflow has no version yet.</p>
            ) : null}
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {versions.map((version) => (
                <li key={version.version} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="flex shrink-0 items-center gap-2 font-medium whitespace-nowrap">
                    Version {version.version}
                    {version.version === latestVersion ? (
                      <Badge variant="secondary">Latest</Badge>
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {publishedAtText(version.publishedAt)}
                  </span>
                  <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                    {plural(version.taskCount, "task")}
                  </span>
                  <Button asChild size="xs" variant="outline">
                    <Link
                      to={workflowVersionPath(workflowId, version.version)}
                      onClick={() => onOpenChange(false)}
                    >
                      <Eye className="size-3.5" />
                      Open
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </DialogBody>
          <DialogFooter className={WORKFLOW_DIALOG.footer}>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            {/* The reason sits right above the button that it explains. */}
            <div className="flex flex-col items-end gap-1.5">
              {moveBlocker && query.isSuccess ? (
                <p className="text-[13px] leading-5 text-muted-foreground">{moveBlocker}</p>
              ) : null}
              <Button
                type="button"
                variant="outline"
                disabled={latestVersion === null || moveBlocker !== undefined}
                onClick={() => setMoving(true)}
              >
                <ArrowUpToLine className="size-4" />
                Move tasks to latest version
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {movesMounted ? (
        <TaskMovesDialog
          open={moving}
          onOpenChange={setMoving}
          workflowId={workflowId}
          target="latest"
          title="Move tasks to the latest version"
          description="A moved task keeps its state, artifacts, sessions, worktree, and pull request link. Later events and session starts follow the latest version."
          confirmLabel="Move tasks"
          ConfirmIcon={ArrowUpToLine}
          onConfirm={async (tasks) => {
            await moveTasks.mutateAsync({ workflowId, tasks });
            setMoving(false);
          }}
        />
      ) : null}
    </>
  );
}

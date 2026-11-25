import type { WorkflowLibraryEntry, WorkflowTaskRef } from "@openducktor/contracts";
import { builtinSharedState, formatProblemPath } from "@openducktor/workflows";
import { workflowLibraryQueryOptions } from "@openducktor/frontend-core/queries/workflow-library";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Columns3, Globe, Upload } from "lucide-react";
import type { ReactElement } from "react";
import { useWorkspaceState } from "@/state";
import { availabilitySummary, availableTo } from "../../library/workflow-availability";
import { useEditorState, useEditorView } from "../editor-context";
import { isCoreState } from "../model/document-edits";
import { ProblemText } from "../problem-text";
import { TaskMovesDialog } from "./task-moves-dialog";

export type PublishRequest = {
  readonly moveTasks: WorkflowTaskRef[];
  /** The selected repository can use the workflow, so new tasks there can pick it at once. */
  readonly usableHere: boolean;
};

/**
 * The board columns that the draft shares with other workflows by state ID. A shared column must
 * look the same in each workflow. The editor already holds the draft to the published look of the
 * others, so a difference here comes from the draft of another workflow, which must then match. The
 * state IDs of the built-in workflow keep their built-in look, so they never differ.
 */
function SharedColumnsNote({
  workflowId,
  others,
}: {
  workflowId: string;
  others: readonly WorkflowLibraryEntry[];
}): ReactElement | null {
  const states = useEditorState((state) => state.document.definition.states);
  const shared = states.flatMap((state) => {
    if (isCoreState(state.id) || builtinSharedState(state.id)) return [];
    const users = others.flatMap(({ id, name, states: columns }) => {
      const column =
        id === workflowId ? undefined : columns.find(({ id: other }) => other === state.id);
      return column ? [{ name, column }] : [];
    });
    const differs = users.find(
      ({ column }) =>
        column.label !== (state.label || state.id) ||
        (column.tone ?? "neutral") !== (state.tone ?? "neutral"),
    );
    return users.length > 0 ? [{ state, users, differs }] : [];
  });
  if (shared.length === 0) return null;
  const columns = shared.map(({ state }) => `“${state.label || state.id}”`).join(", ");
  const workflows = [...new Set(shared.flatMap(({ users }) => users.map(({ name }) => name)))];
  const one = shared.length === 1;
  return (
    <div className="flex flex-col gap-2 text-sm text-muted-foreground">
      <p className="flex items-start gap-2">
        <Columns3 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>
          {one ? "The column" : "The columns"} {columns} {one ? "is" : "are"} shared with{" "}
          {workflows.join(", ")}. They must look the same in both.
        </span>
      </p>
      {shared.flatMap(({ state, differs }) =>
        differs
          ? [
              <p
                key={state.id}
                className="ml-6 rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-warning-surface-foreground"
              >
                The draft of {differs.name} shows “{state.label || state.id}” another way. It must
                match before {differs.name} can publish.
              </p>,
            ]
          : [],
      )}
    </div>
  );
}

/**
 * Publishes the draft. It lists the open warnings, offers to turn the workflow on for the selected
 * repository, and lists the tasks on older versions that can move to the new version.
 */
export function PublishDialog({
  open,
  onOpenChange,
  workflowId,
  latestVersion,
  onPublish,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowId: string;
  latestVersion: number | null;
  onPublish: (request: PublishRequest) => Promise<void>;
}): ReactElement {
  const problems = useEditorView((view) => view.problems);
  const { activeWorkspace, workspaces } = useWorkspaceState();
  const library = useQuery({ ...workflowLibraryQueryOptions(), enabled: open });
  const entry = library.data?.workflows.find(({ id }) => id === workflowId);
  const warnings = problems.filter(({ severity }) => severity === "warning");

  return (
    <TaskMovesDialog
      open={open}
      onOpenChange={onOpenChange}
      workflowId={workflowId}
      target="draft"
      title="Publish the draft"
      description={`The draft becomes version ${(latestVersion ?? 0) + 1}. New tasks use it.`}
      movesTitle="Move tasks from older versions"
      showMoves={latestVersion !== null}
      confirmLabel={warnings.length > 0 ? "Publish anyway" : "Publish"}
      ConfirmIcon={Upload}
      onConfirm={(moveTasks) =>
        onPublish({
          moveTasks,
          usableHere:
            entry !== undefined &&
            activeWorkspace !== null &&
            availableTo(entry.availability, activeWorkspace.workspaceId),
        })
      }
    >
      {library.data ? (
        <SharedColumnsNote workflowId={workflowId} others={library.data.workflows} />
      ) : null}
      {warnings.length > 0 ? (
        // The look of the problems panel: a quiet surface with an amber mark on each row.
        <section className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3">
          <h3 className="text-sm font-medium">{warnings.length} to check</h3>
          <ul className="flex flex-col gap-1.5 text-sm">
            {warnings.map((warning) => (
              <li
                key={`${warning.target.key}:${formatProblemPath(warning.path)}:${warning.message}`}
                className="flex items-start gap-2"
              >
                <AlertTriangle
                  aria-label="Warning"
                  className="mt-0.5 size-4 shrink-0 text-warning-muted"
                />
                <span>
                  <ProblemText message={warning.message} />
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs leading-5 text-muted-foreground">
            You can publish with these warnings, or close this and fix them first.
          </p>
        </section>
      ) : null}
      {entry ? (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Globe aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            Available in: {availabilitySummary(entry.availability, workspaces)}. You can change it
            on the Workflows page.
          </span>
        </p>
      ) : null}
    </TaskMovesDialog>
  );
}

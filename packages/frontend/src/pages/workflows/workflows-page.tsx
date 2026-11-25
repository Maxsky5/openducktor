import type { WorkflowLibraryEntry, WorkflowLibraryRole } from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { workflowLibraryQueryOptions } from "@openducktor/frontend-core/queries/workflow-library";
import { workflowCatalogQueryOptions } from "@openducktor/frontend-core/queries/workflows";
import { roleInputOf } from "@openducktor/workflows";
import { useQuery } from "@tanstack/react-query";
import { FileDown, Plus } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useDialogPresence } from "@/components/ui/dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AvailabilityDialog } from "@/features/workflows/library/availability-dialog";
import { ExportWorkflowDialog } from "@/features/workflows/library/export-workflow-dialog";
import { DeleteRoleDialog } from "@/features/workflows/library/delete-role-dialog";
import { DeleteWorkflowDialog } from "@/features/workflows/library/delete-workflow-dialog";
import { EmptyWorkflowsCard } from "@/features/workflows/library/empty-workflows-card";
import { ImportWorkflowDialog } from "@/features/workflows/library/import-workflow-dialog";
import { NewWorkflowDialog } from "@/features/workflows/library/new-workflow-dialog";
import { WorkflowList } from "@/features/workflows/library/workflow-list";
import { WorkflowRolesSection } from "@/features/workflows/library/workflow-roles-section";
import { useRoleFormDialog } from "@/features/workflows/roles/role-form-dialog";
import { duplicateRoleInput, newRoleInput } from "@/features/workflows/roles/role-input";
import { useDuplicateWorkflow } from "@/features/workflows/use-duplicate-workflow";
import { useSetDefaultWorkflow } from "@/features/workflows/use-workflow-library-commands";
import { workflowPath } from "@/features/workflows/workflow-routes";
import { preloadWorkflowEditorPage } from "@/pages";

/** The title, what the page sets, Import, and New workflow. */
function WorkflowsPageHeader({
  onImport,
  onCreate,
}: {
  onImport: () => void;
  onCreate: () => void;
}): ReactElement {
  return (
    // The buttons stay at the right. The description wraps on a narrow page instead.
    <header className="electron-titlebar-safe-area flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h1 className="text-xl font-semibold tracking-tight">Workflows</h1>
        <p className="text-sm text-muted-foreground">
          A workflow sets the board columns of a task and how it moves between them.
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={onImport}>
          <FileDown className="size-3.5" />
          Import
        </Button>
        <Button type="button" size="sm" className="gap-1.5" onClick={onCreate}>
          <Plus className="size-3.5" />
          New workflow
        </Button>
      </div>
    </header>
  );
}

/** One row of the workflow list while it loads: its tile, its name, and its board strip. */
function SkeletonRow(): ReactElement {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div className="size-9 rounded-lg bg-muted" />
      <div className="flex flex-col gap-2">
        <div className="h-3.5 w-40 rounded-md bg-muted" />
        <div className="h-3 w-72 rounded-md bg-muted" />
      </div>
    </div>
  );
}

/** The workflow list while it loads, in its own shape, or the reason it could not load. */
function LibraryReadState({
  pending,
  error,
}: {
  pending: boolean;
  error: Error | null;
}): ReactElement | null {
  if (error)
    return (
      <Alert variant="destructive">
        <AlertDescription>The workflows could not load. {errorMessage(error)}</AlertDescription>
      </Alert>
    );
  if (!pending) return null;
  return (
    <div
      role="status"
      aria-label="Reading workflows"
      className="animate-pulse divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="h-9 bg-muted/40" />
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </div>
  );
}

/**
 * The workflows and workflow roles of the host, for every repository: the selected repository
 * changes nothing here. Each workflow sets the repositories that can use it.
 */
export function WorkflowsPage(): ReactElement {
  const query = useQuery(workflowLibraryQueryOptions());
  const library = query.data;
  // A user here opens a workflow next, so its editor code and catalog load now.
  useEffect(preloadWorkflowEditorPage, []);
  useQuery(workflowCatalogQueryOptions());
  const setDefault = useSetDefaultWorkflow();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exported, setExported] = useState<WorkflowLibraryEntry | null>(null);
  // IDs, so the dialogs read the entry again after a library change.
  const [deletedWorkflowId, setDeletedWorkflowId] = useState<string | null>(null);
  const [availabilityWorkflowId, setAvailabilityWorkflowId] = useState<string | null>(null);
  const [deletedRole, setDeletedRole] = useState<WorkflowLibraryRole | null>(null);
  const { duplicate, duplicatingId } = useDuplicateWorkflow();
  const newMounted = useDialogPresence(creating);
  const importMounted = useDialogPresence(importing);
  const exportMounted = useDialogPresence(exported !== null);
  const roles = library?.roles ?? [];
  const { openRole, dialog: roleDialog } = useRoleFormDialog(roles);
  const catalogRoles = roles.map(({ role }) => role);

  const entryOf = (workflowId: string | null) =>
    library?.workflows.find(({ id }) => id === workflowId) ?? null;
  const deletedEntry = entryOf(deletedWorkflowId);
  const availabilityEntry = entryOf(availabilityWorkflowId);

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col overflow-y-auto">
        <div className="flex w-full flex-col gap-8 px-6 py-5">
          <WorkflowsPageHeader
            onImport={() => setImporting(true)}
            onCreate={() => setCreating(true)}
          />

          <LibraryReadState pending={query.isPending} error={query.error} />

          {library ? (
            <>
              <section aria-label="Workflow list" className="flex flex-col gap-4">
                <WorkflowList
                  entries={library.workflows}
                  defaultWorkflowId={library.defaultWorkflowId}
                  duplicatingId={duplicatingId}
                  commands={{
                    duplicate: (entry) => duplicate(entry.id),
                    remove: (entry) => setDeletedWorkflowId(entry.id),
                    exportFile: (entry) => setExported(entry),
                    editAvailability: (entry) => setAvailabilityWorkflowId(entry.id),
                    setDefault: (entry) =>
                      setDefault.mutate(
                        { workflowId: entry.id },
                        {
                          onError: (cause) =>
                            toast.error("The default workflow could not change", {
                              description: errorMessage(cause),
                            }),
                        },
                      ),
                  }}
                />
                <EmptyWorkflowsCard
                  workflows={library.workflows}
                  onCreate={() => setCreating(true)}
                />
              </section>
              <WorkflowRolesSection
                library={library}
                commands={{
                  create: () => openRole({ mode: "create", input: newRoleInput(catalogRoles) }),
                  open: (entry) =>
                    openRole({
                      mode: entry.source === "builtin" ? "view" : "update",
                      input: roleInputOf(entry.role),
                    }),
                  duplicate: (entry) =>
                    openRole({
                      mode: "create",
                      input: duplicateRoleInput(entry.role, catalogRoles),
                    }),
                  remove: (entry) => setDeletedRole(entry),
                }}
              />
            </>
          ) : null}
        </div>

        {newMounted ? (
          <NewWorkflowDialog
            open={creating}
            workflows={library?.workflows ?? []}
            onOpenChange={setCreating}
            onCreated={(workflowId) => navigate(workflowPath(workflowId))}
          />
        ) : null}
        {importMounted ? (
          <ImportWorkflowDialog
            open={importing}
            onOpenChange={setImporting}
            onImported={(workflowId) => navigate(workflowPath(workflowId))}
          />
        ) : null}
        {exportMounted && exported ? (
          <ExportWorkflowDialog
            open={exported !== null}
            onOpenChange={(open) => !open && setExported(null)}
            workflowId={exported.id}
            workflowName={exported.name}
            latestVersion={exported.latestVersion}
            hasDraft={exported.draft !== null}
          />
        ) : null}
        <DeleteWorkflowDialog
          entry={deletedEntry}
          isDefault={deletedEntry?.id === library?.defaultWorkflowId}
          onClose={() => setDeletedWorkflowId(null)}
        />
        <AvailabilityDialog
          entry={availabilityEntry}
          isDefault={availabilityEntry?.id === library?.defaultWorkflowId}
          onClose={() => setAvailabilityWorkflowId(null)}
        />
        <DeleteRoleDialog entry={deletedRole} onClose={() => setDeletedRole(null)} />
        {roleDialog}
      </div>
    </TooltipProvider>
  );
}

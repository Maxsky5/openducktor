import type { WorkspaceRecord } from "@openducktor/contracts";
import { ArrowRight, FolderOpen, RotateCcw } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";

type OpenRepositoryChoicesProps = {
  closedWorkspaces: WorkspaceRecord[];
  disabled: boolean;
  error: string | null;
  onChooseNew: () => void;
  onReopen: (workspaceId: string, repoPath: string) => void;
};

export function OpenRepositoryChoices({
  closedWorkspaces,
  disabled,
  error,
  onChooseNew,
  onReopen,
}: OpenRepositoryChoicesProps): ReactElement {
  return (
    <div className={closedWorkspaces.length > 0 ? "grid gap-5 lg:grid-cols-2" : "grid"}>
      <section className="flex flex-col items-start rounded-xl border border-border bg-card p-5 sm:p-6">
        <div className="mb-5 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <FolderOpen className="size-6" aria-hidden="true" />
        </div>
        <h3 className="text-base font-semibold text-foreground">Open a new workspace</h3>
        <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
          Choose a local Git repository, then set its name, color, and models.
        </p>
        <Button type="button" size="lg" className="mt-6" disabled={disabled} onClick={onChooseNew}>
          <FolderOpen data-icon="inline-start" /> Choose repository folder
        </Button>
      </section>

      {closedWorkspaces.length > 0 ? (
        <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <div className="mb-5 flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <RotateCcw className="size-6" aria-hidden="true" />
          </div>
          <h3 className="text-base font-semibold text-foreground">Reopen a workspace</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Pick up work in a workspace you closed.
          </p>
          <div className="mt-5 grid gap-2">
            {closedWorkspaces.map((workspace) => (
              <Button
                key={workspace.workspaceId}
                type="button"
                variant="outline"
                className="h-auto w-full justify-start gap-3 overflow-hidden p-3 text-left"
                disabled={disabled}
                onClick={() => onReopen(workspace.workspaceId, workspace.repoPath)}
              >
                <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{workspace.workspaceName}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {workspace.repoPath}
                  </span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
              </Button>
            ))}
          </div>
          {error ? (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </section>
      ) : null}
      {closedWorkspaces.length === 0 && error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

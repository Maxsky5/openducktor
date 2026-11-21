import type { WorkflowLibrary, WorkflowLibraryRole } from "@openducktor/contracts";
import { Copy, ExternalLink, Plus, Trash2 } from "lucide-react";
import { roleIconForHint } from "@/lib/agent-role-presentation";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ActionMenu, type MenuCommand } from "../action-menu";

export type RoleRowCommands = {
  readonly create: () => void;
  readonly open: (entry: WorkflowLibraryRole) => void;
  readonly duplicate: (entry: WorkflowLibraryRole) => void;
  readonly remove: (entry: WorkflowLibraryRole) => void;
};

// Used by spans the Status and repository columns of the workflow list, so both tables line up.
const GRID = "grid grid-cols-[minmax(0,1fr)_minmax(0,25.5rem)_2.5rem] items-center gap-x-6";

const roleCommands = (entry: WorkflowLibraryRole, commands: RoleRowCommands): MenuCommand[] => {
  const custom = entry.source === "custom";
  const list: MenuCommand[] = [
    { label: custom ? "Edit" : "View", Icon: ExternalLink, run: () => commands.open(entry) },
    { label: "Duplicate", Icon: Copy, run: () => commands.duplicate(entry) },
  ];
  if (custom)
    list.push({
      label: "Delete",
      Icon: Trash2,
      run: () => commands.remove(entry),
      destructive: true,
    });
  return list;
};

/** The most workflow names that a role row shows before a count of the others. */
const SHOWN_WORKFLOWS = 2;

/** The workflows that use a role, as chips. A name can hold a comma, so a list of words cannot. */
function WorkflowChips({ names }: { names: readonly string[] }): ReactElement {
  if (names.length === 0) return <span className="text-sm text-muted-foreground">No workflow</span>;
  const hidden = names.length - SHOWN_WORKFLOWS;
  return (
    <ul className="flex min-w-0 items-center gap-1" title={names.join("\n")}>
      {names.slice(0, SHOWN_WORKFLOWS).map((name) => (
        <li
          key={name}
          className="min-w-0 truncate rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
        >
          {name}
        </li>
      ))}
      {hidden > 0 ? (
        <li className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground tabular-nums">
          +{hidden}
        </li>
      ) : null}
    </ul>
  );
}

/**
 * The workflow roles of the host catalog, built-in and custom, with the workflows that use each.
 * They differ from the custom agent roles of a workspace.
 */
export function WorkflowRolesSection({
  library,
  commands,
}: {
  library: WorkflowLibrary;
  commands: RoleRowCommands;
}): ReactElement {
  const names = new Map(library.workflows.map(({ id, name }) => [id, name]));
  return (
    <section aria-labelledby="workflow-roles-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="workflow-roles-title" className="text-base font-semibold">
            Workflow roles
          </h2>
          <p className="text-sm text-muted-foreground">
            The agents that workflows can start. A change to a role applies to every workflow that
            uses it.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={commands.create}
        >
          <Plus className="size-3.5" />
          New role
        </Button>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div
          aria-hidden="true"
          className={cn(
            GRID,
            "border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground",
          )}
        >
          <span>Role</span>
          <span>Used by</span>
          <span />
        </div>
        <ul className="divide-y divide-border">
          {library.roles.map((entry) => {
            const workflows = entry.workflowIds.map((id) => names.get(id) ?? id);
            const RoleIcon = roleIconForHint(entry.role.icon);
            return (
              <li
                key={entry.role.id}
                className={cn(GRID, "relative px-4 py-3 transition-colors hover:bg-accent/50")}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300">
                    <RoleIcon aria-hidden="true" className="size-4" />
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <button
                      type="button"
                      className="truncate text-left text-sm font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                      onClick={() => commands.open(entry)}
                    >
                      {entry.role.label}
                    </button>
                    <span className="truncate text-xs text-muted-foreground">
                      {entry.source === "builtin" ? "Built-in" : "Custom"} ·{" "}
                      <span className="font-mono">{entry.role.id}</span>
                    </span>
                  </div>
                </div>
                <WorkflowChips names={workflows} />
                <div className="relative flex justify-end">
                  <ActionMenu
                    label={`Actions for ${entry.role.label}`}
                    commands={roleCommands(entry, commands)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

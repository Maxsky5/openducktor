import type {
  AgentRoleDefinition,
  WorkflowLibraryRole,
  WorkflowProblem,
  WorkflowRoleImpact,
  WorkflowRoleInput,
} from "@openducktor/contracts";
import { workflowRoleImpactQueryOptions } from "@openducktor/frontend-core/queries/workflow-library";
import { checkWorkflowRole, idFromLabel } from "@openducktor/workflows";
import { useQuery } from "@tanstack/react-query";
import { Copy, Loader2, Save } from "lucide-react";
import { type ReactElement, type ReactNode, useCallback, useMemo, useRef, useState } from "react";
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
  useDialogPresence,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { commandStatus, useSaveRole } from "../use-workflow-library-commands";
import { WORKFLOW_DIALOG } from "../workflow-dialog";
import { RoleFormFields } from "./role-form-fields";
import { duplicateRoleInput, problemsByField, type RoleFormMode } from "./role-input";

export type RoleFormRequest = {
  readonly mode: RoleFormMode;
  readonly input: WorkflowRoleInput;
  /** Runs after a save, such as to bind a new role in the open draft. */
  readonly onSaved?: (role: AgentRoleDefinition) => void;
};

const saveLabel = (confirming: boolean, pending: boolean): string => {
  if (pending) return "Saving…";
  return confirming ? "Save for all workflows" : "Save role";
};

const titleOf = (mode: RoleFormMode, label: string): string => {
  if (mode === "create") return "New role";
  return mode === "update" ? `Edit ${label || "the role"}` : label;
};

const DESCRIPTIONS = {
  create: "An agent that workflows can start, with its tools and instructions.",
  update: "A change applies to every workflow that uses this role, for new sessions.",
  view: "Built-in roles are read-only. Duplicate this role to make a copy that you can change.",
} satisfies Record<RoleFormMode, string>;

/** Read-only fields keep full-contrast text and controls instead of the faded disabled look. */
const READ_ONLY_CLASS =
  "[&_:is(button,input,textarea):disabled]:opacity-100 [&_:is(input,textarea):disabled]:text-foreground [&_[data-disabled]]:opacity-100";

/** The impact that a save asks the user to confirm: published workflows and running sessions. */
function ImpactConfirmation({ impact }: { impact: WorkflowRoleImpact }): ReactElement {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>These published workflows bind the role. The change applies to all of them:</p>
      <ul className="list-disc pl-5">
        {impact.workflows.map((workflow) => (
          <li key={workflow.id}>{workflow.name}</li>
        ))}
      </ul>
      {impact.runningSessions > 0 ? (
        <Alert variant="warning">
          <AlertDescription>
            {impact.runningSessions === 1
              ? "1 running session of this role keeps the earlier role. Restart it to use the change."
              : `${impact.runningSessions} running sessions of this role keep the earlier role. Restart them to use the change.`}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function RoleFormDialog({
  open,
  request,
  catalogRoles,
  onOpenChange,
  onReplace,
}: {
  open: boolean;
  request: RoleFormRequest;
  catalogRoles: readonly WorkflowLibraryRole[];
  onOpenChange: (open: boolean) => void;
  onReplace: (request: RoleFormRequest) => void;
}): ReactElement {
  // An update reads the workflows that bind the role when the user saves it.
  const impactRead = useQuery({
    ...workflowRoleImpactQueryOptions(request.input.id),
    enabled: false,
  });
  const saveRole = useSaveRole();
  const [input, setInput] = useState(request.input);
  // The ID follows the name of a new role until the user edits the ID.
  const idEdited = useRef(request.mode !== "create");
  const [impact, setImpact] = useState<WorkflowRoleImpact | null>(null);
  const [hostProblems, setHostProblems] = useState<{
    input: WorkflowRoleInput;
    problems: readonly WorkflowProblem[];
  } | null>(null);
  const { pending, error } = commandStatus(
    { isPending: impactRead.isFetching, error: impactRead.error },
    saveRole,
  );
  const roles = useMemo(() => catalogRoles.map(({ role }) => role), [catalogRoles]);
  const editing = request.mode !== "view";
  const liveProblems = useMemo(
    () =>
      request.mode === "view"
        ? []
        : checkWorkflowRole(input, { roles, mode: request.mode, bindingVersions: [] }),
    [input, roles, request.mode],
  );
  const problems = hostProblems?.input === input ? hostProblems.problems : liveProblems;
  const blocked = problems.some(({ severity }) => severity === "error");

  const commit = (mode: Exclude<RoleFormMode, "view">) =>
    saveRole.mutate(
      { role: input, mode },
      {
        onSuccess: (result) => {
          if (result.outcome === "problems") {
            setImpact(null);
            setHostProblems({ input, problems: result.problems });
            return;
          }
          request.onSaved?.(result.role);
          onOpenChange(false);
        },
      },
    );

  /** An update asks first when other workflows bind the role. */
  const save = (confirmed: boolean) => {
    const { mode } = request;
    if (mode === "view") return;
    saveRole.reset();
    if (mode === "create" || confirmed) {
      commit(mode);
      return;
    }
    // A failed read keeps its last data, so only a read that succeeded decides.
    void impactRead.refetch().then(({ data, isSuccess }) => {
      if (!isSuccess) return;
      if (data.workflows.length > 0) setImpact(data);
      else commit(mode);
    });
  };

  const change = (next: WorkflowRoleInput) => {
    if (next.id !== input.id) idEdited.current = true;
    if (!idEdited.current && next.label !== input.label)
      setInput({ ...next, id: idFromLabel(next.label, new Set(roles.map(({ id }) => id))) });
    else setInput(next);
  };
  const viewedRole = roles.find(({ id }) => id === input.id);

  let body: ReactNode = (
    <RoleFormFields
      input={input}
      onChange={change}
      problems={problemsByField(problems)}
      idFixed={request.mode !== "create"}
      disabled={!editing || pending}
    />
  );
  if (impact) body = <ImpactConfirmation impact={impact} />;

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className={WORKFLOW_DIALOG.lg}>
        <DialogHeader className={WORKFLOW_DIALOG.header}>
          <DialogTitle className="flex items-center gap-2">
            {impact ? "Save the role for every workflow?" : titleOf(request.mode, input.label)}
            {request.mode === "view" && !impact ? (
              <span className="inline-flex h-5 items-center rounded-full border border-border px-2 text-xs font-medium text-muted-foreground">
                Built-in
              </span>
            ) : null}
          </DialogTitle>
          <DialogDescription>{DESCRIPTIONS[request.mode]}</DialogDescription>
        </DialogHeader>
        <DialogBody
          className={cn(
            WORKFLOW_DIALOG.body,
            "flex flex-col gap-3 pb-10",
            request.mode === "view" && READ_ONLY_CLASS,
          )}
        >
          {body}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {/* A fade at the bottom edge tells that the form scrolls under the footer. */}
          <div
            aria-hidden="true"
            className="pointer-events-none sticky -bottom-10 -mt-3 -mb-10 h-10 shrink-0 bg-linear-to-t from-popover to-transparent"
          />
        </DialogBody>
        <DialogFooter className={WORKFLOW_DIALOG.footer}>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => (impact ? setImpact(null) : onOpenChange(false))}
          >
            {impact ? "Back" : "Cancel"}
          </Button>
          {editing ? (
            <Button
              type="button"
              disabled={pending || blocked}
              onClick={() => save(impact !== null)}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {saveLabel(impact !== null, pending)}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={!viewedRole}
              onClick={() => {
                if (!viewedRole) return;
                const copy: RoleFormRequest = {
                  mode: "create",
                  input: duplicateRoleInput(viewedRole, roles),
                };
                onReplace(request.onSaved ? { ...copy, onSaved: request.onSaved } : copy);
              }}
            >
              <Copy className="size-4" />
              Duplicate
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The role form of a page or an editor. Saves apply at once and stay outside the undo of any
 * draft.
 */
export const useRoleFormDialog = (catalogRoles: readonly WorkflowLibraryRole[]) => {
  const [request, setRequest] = useState<{ key: number; value: RoleFormRequest } | null>(null);
  const [open, setOpen] = useState(false);
  const mounted = useDialogPresence(open);
  const openRole = useCallback((value: RoleFormRequest) => {
    setRequest((current) => ({ key: (current?.key ?? 0) + 1, value }));
    setOpen(true);
  }, []);
  const dialog =
    mounted && request ? (
      <RoleFormDialog
        key={request.key}
        open={open}
        request={request.value}
        catalogRoles={catalogRoles}
        onOpenChange={setOpen}
        onReplace={openRole}
      />
    ) : null;
  return { openRole, dialog };
};

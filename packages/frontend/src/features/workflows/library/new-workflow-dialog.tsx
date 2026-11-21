import type { WorkflowLibraryEntry, WorkflowLibraryState } from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { Copy, Loader2, Plus, Sparkles } from "lucide-react";
import { type ReactElement, useId, useState } from "react";
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
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionCard, OptionCardMark } from "@/components/ui/option-card";
import { cn } from "@/lib/utils";
import { useCreateWorkflow } from "../use-workflow-library-commands";
import { WORKFLOW_DIALOG } from "../workflow-dialog";
import { StatePipeline } from "./state-pipeline";

/** The choice of a blank workflow. Every other choice is a workflow ID. */
const BLANK = "\u0000blank";

/** The core states of a blank workflow, as the workflow list shows them. */
const BLANK_STATES: WorkflowLibraryState[] = [
  { id: "open", label: "Backlog" },
  { id: "closed", label: "Done", tone: "success" },
];

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The choice of a copy of a custom workflow, which the picker under the choices names. */
const OTHER = "\u0000other";

/** One way to start: a copy of the built-in workflow, a copy of another one, or a blank one. */
function StartCard({
  value,
  title,
  detail,
  Icon,
  recommended = false,
}: {
  value: string;
  title: string;
  detail: string;
  Icon: typeof Plus;
  recommended?: boolean;
}): ReactElement {
  return (
    <OptionCard value={value} className="flex flex-col gap-2 rounded-xl bg-card p-3.5">
      <span className="flex items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground group-data-[state=checked]:text-foreground">
          <Icon aria-hidden="true" className="size-4" />
        </span>
        {recommended ? (
          <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[11px] leading-4 font-medium text-primary-emphasis dark:bg-primary/20">
            Recommended
          </span>
        ) : null}
        <OptionCardMark className={cn(!recommended && "ml-auto")} />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs leading-5 text-balance text-muted-foreground">{detail}</span>
      </span>
    </OptionCard>
  );
}

/**
 * Creates a workflow from a name and a start: a copy of the built-in workflow, which a new user
 * can learn from, a copy of a custom workflow, or a blank workflow with the core states only.
 */
export function NewWorkflowDialog({
  open,
  onOpenChange,
  onCreated,
  workflows,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (workflowId: string) => void;
  /** The workflows that a new one can start from. */
  workflows: readonly WorkflowLibraryEntry[];
}): ReactElement {
  const createWorkflow = useCreateWorkflow();
  const id = useId();
  const builtin = workflows.find(({ source }) => source === "builtin");
  const customs = workflows.filter(({ source }) => source === "custom");
  const [choice, setChoice] = useState(builtin?.id ?? BLANK);
  const [otherId, setOtherId] = useState(customs[0]?.id ?? "");
  const [name, setName] = useState("");
  const pending = createWorkflow.isPending;
  const error = createWorkflow.error ? errorMessage(createWorkflow.error) : null;
  const from = choice === OTHER ? otherId : choice;
  const source = workflows.find((entry) => entry.id === from);
  const create = () => {
    const trimmed = name.trim();
    createWorkflow.mutate(source ? { name: trimmed, from: source.id } : { name: trimmed }, {
      onSuccess: ({ workflowId }) => {
        onOpenChange(false);
        onCreated(workflowId);
      },
    });
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className={WORKFLOW_DIALOG.lg}>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim().length > 0) create();
          }}
        >
          <DialogHeader className={WORKFLOW_DIALOG.header}>
            <DialogTitle>New workflow</DialogTitle>
            <DialogDescription>
              A workflow is the set of board columns that a task moves through.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className={cn(WORKFLOW_DIALOG.body, "flex flex-col gap-5")}>
            <div className="flex flex-col gap-2">
              <Label htmlFor={id}>Name</Label>
              <Input
                id={id}
                autoFocus
                value={name}
                placeholder="Such as Bug triage"
                disabled={pending}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <span id={`${id}-from`} className="text-sm font-medium">
                Start from
              </span>
              <RadioGroupPrimitive.Root
                aria-labelledby={`${id}-from`}
                value={choice}
                disabled={pending}
                onValueChange={setChoice}
                className={cn(
                  "grid gap-2.5",
                  customs.length > 0 ? "sm:grid-cols-3" : "sm:grid-cols-2",
                )}
              >
                {builtin ? (
                  <StartCard
                    value={builtin.id}
                    title={`Copy of ${builtin.name}`}
                    detail="A complete flow with agents. Change what you need."
                    Icon={Sparkles}
                    recommended
                  />
                ) : null}
                {customs.length > 0 ? (
                  <StartCard
                    value={OTHER}
                    title="Copy of another workflow"
                    detail="Any of your workflows."
                    Icon={Copy}
                  />
                ) : null}
                <StartCard
                  value={BLANK}
                  title="Blank workflow"
                  detail="Backlog and Done. You add the rest."
                  Icon={Plus}
                />
              </RadioGroupPrimitive.Root>
              {choice === OTHER ? (
                <Combobox
                  value={otherId}
                  options={customs.map((entry) => ({ value: entry.id, label: entry.name }))}
                  searchable={customs.length > 8}
                  disabled={pending}
                  triggerAriaLabelledBy={`${id}-from`}
                  onValueChange={setOtherId}
                />
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5 rounded-lg bg-muted/40 px-3 py-2.5">
              <span className="text-xs font-medium text-muted-foreground">
                {source
                  ? `${plural(source.states.length, "state")} · ${plural(source.transitionCount, "transition")}`
                  : "2 states · no transition yet"}
              </span>
              <StatePipeline states={source?.states ?? BLANK_STATES} />
            </div>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </DialogBody>
          <DialogFooter className={WORKFLOW_DIALOG.footer}>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || name.trim().length === 0}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

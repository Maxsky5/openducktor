import {
  runtimeSupportedScopeValues,
  type AgentToolName,
  type WorkflowRoleInput,
} from "@openducktor/contracts";
import { type ReactElement, type ReactNode, useId, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { OptionCard, OptionCardMark } from "@/components/ui/option-card";
import { RadioGroup } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { Disclosure } from "../disclosure";
import { FILE_ACCESS_OPTIONS, TOOL_GROUPS, TOOL_LABELS } from "./role-tools";

/** A label, its control, a hint, and the problems of one role field. */
export function RoleField({
  label,
  labelId,
  controlId,
  problems,
  hint,
  className,
  children,
}: {
  label: string;
  labelId: string;
  controlId?: string;
  problems: readonly string[] | undefined;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label id={labelId} htmlFor={controlId} className="text-sm font-medium text-foreground">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
      {problems?.map((message) => (
        <p key={message} className="text-xs leading-5 text-destructive-muted">
          {message}
        </p>
      ))}
    </div>
  );
}

type FieldsProps = {
  input: WorkflowRoleInput;
  onChange: (input: WorkflowRoleInput) => void;
  problems: ReadonlyMap<string, readonly string[]>;
  disabled: boolean;
};

/** What the role may do with the files of the task. The runtimes enforce a read-only role. */
export function AccessFields({ input, onChange, problems, disabled }: FieldsProps): ReactElement {
  const id = useId();
  return (
    <div className="flex flex-col gap-4">
      <RoleField label="Files" labelId={id} problems={problems.get("workspaceAccess")}>
        <RadioGroup
          aria-labelledby={id}
          value={input.workspaceAccess}
          disabled={disabled}
          className="grid gap-2 sm:grid-cols-2"
          onValueChange={(value) =>
            onChange({ ...input, workspaceAccess: value === "write" ? "write" : "read" })
          }
        >
          {FILE_ACCESS_OPTIONS.map((option) => (
            <OptionCard
              key={option.value}
              value={option.value}
              className="flex items-start gap-2.5 px-3 py-2.5 text-sm"
            >
              <OptionCardMark className="mt-0.5" />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{option.label}</span>
                <span className="text-xs leading-5 text-muted-foreground">{option.hint}</span>
              </span>
            </OptionCard>
          ))}
        </RadioGroup>
      </RoleField>
    </div>
  );
}

/** The tools in groups. The tool name shows in a tooltip. */
export function ToolFields({ input, onChange, problems, disabled }: FieldsProps): ReactElement {
  const id = useId();
  const selected = new Set(input.tools);
  const toggleGroup = (tools: readonly AgentToolName[], on: boolean) => {
    const changed = new Set(tools);
    onChange({
      ...input,
      tools: TOOL_GROUPS.flatMap((group) => group.tools).filter((value) =>
        changed.has(value) ? on : selected.has(value),
      ),
    });
  };
  const toggle = (tool: AgentToolName, on: boolean) => toggleGroup([tool], on);
  return (
    <RoleField
      label="OpenDucktor tools"
      labelId={id}
      problems={problems.get("tools")}
      hint="“Move the task” lets the agent send a transition. A role that only saves documents does not need it, because a save can also move the task."
    >
      <div className="flex flex-col gap-3">
        {TOOL_GROUPS.map((group) => {
          const count = group.tools.filter((tool) => selected.has(tool)).length;
          const all = count === group.tools.length;
          return (
            <fieldset
              key={group.title}
              className="flex flex-col gap-2 rounded-lg border border-border p-3"
            >
              <legend className="sr-only">{group.title}</legend>
              <div className="flex items-center justify-between gap-3 text-xs">
                <span aria-hidden="true" className="font-medium text-foreground">
                  {group.title}
                </span>
                <span className="flex items-center gap-3">
                  <span aria-hidden="true" className="text-muted-foreground tabular-nums">
                    {count} of {group.tools.length}
                  </span>
                  {disabled ? null : (
                    <button
                      type="button"
                      aria-label={`${all ? "Clear" : "Select all"} ${group.title.toLowerCase()}`}
                      className="rounded-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => toggleGroup(group.tools, !all)}
                    >
                      {all ? "Clear" : "Select all"}
                    </button>
                  )}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-3">
                {group.tools.map((tool) => (
                  <label
                    key={tool}
                    title={tool}
                    className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-sm transition-colors has-[:enabled]:cursor-pointer has-[:enabled]:hover:bg-accent/60"
                  >
                    <Checkbox
                      checked={selected.has(tool)}
                      disabled={disabled}
                      onCheckedChange={(checked) => toggle(tool, checked === true)}
                    />
                    <span className="truncate">{TOOL_LABELS[tool]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
    </RoleField>
  );
}

/**
 * The icon, the side panel, and the runtime scopes. Open while one has a problem. Opening it
 * scrolls it into view, since it sits at the bottom of the form.
 */
export function MoreRoleOptions({
  input,
  onChange,
  problems,
  disabled,
  children,
}: FieldsProps & { children: ReactNode }): ReactElement {
  const id = useId();
  const hasProblem = ["icon", "defaultPanel", "runtimeScopes"].some((field) => problems.has(field));
  const [chosenOpen, setChosenOpen] = useState<boolean | null>(null);
  const section = useRef<HTMLDivElement>(null);
  const scopes = new Set(input.runtimeScopes);
  const openChange = (open: boolean) => {
    setChosenOpen(open);
    if (open)
      requestAnimationFrame(() =>
        section.current?.scrollIntoView({
          block: "start",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        }),
      );
  };
  return (
    <div ref={section}>
      <Disclosure
        title="More options"
        description="Icon, side panel, and runtime scopes"
        open={chosenOpen ?? hasProblem}
        onOpenChange={openChange}
        className="border-t border-border pt-4"
      >
        <div className="grid items-start gap-4 sm:grid-cols-2">
          {children}
          <RoleField
            label="Runtime scopes"
            labelId={`${id}-scopes`}
            problems={problems.get("runtimeScopes")}
            hint="A runtime must support these scopes to run the role."
            className="sm:col-span-2"
          >
            <div
              role="group"
              aria-labelledby={`${id}-scopes`}
              className="flex flex-wrap gap-x-6 gap-y-2"
            >
              {runtimeSupportedScopeValues.map((scope) => (
                <label
                  key={scope}
                  className="flex items-center gap-2 text-sm has-[:enabled]:cursor-pointer"
                >
                  <Checkbox
                    checked={scopes.has(scope)}
                    disabled={disabled}
                    onCheckedChange={(checked) =>
                      onChange({
                        ...input,
                        runtimeScopes: runtimeSupportedScopeValues.filter((value) =>
                          value === scope ? checked === true : scopes.has(value),
                        ),
                      })
                    }
                  />
                  {SCOPE_LABELS[scope]}
                </label>
              ))}
            </div>
          </RoleField>
        </div>
      </Disclosure>
    </div>
  );
}

const SCOPE_LABELS = {
  workspace: "Workspace",
  task: "Task",
  build: "Build",
} satisfies Record<(typeof runtimeSupportedScopeValues)[number], string>;

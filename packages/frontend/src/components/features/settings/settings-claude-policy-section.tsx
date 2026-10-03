import { claudeRuntimeConfigSchema, type ClaudeRuntimeConfig } from "@openducktor/contracts";
import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { readClaudePolicyField } from "./settings-claude-policy";
import { ClaudePolicyCard, CLAUDE_POLICY_ROLES } from "./settings-claude-policy-card";
import { CLAUDE_POLICY_GROUPS, type ClaudePolicyField } from "./settings-claude-policy-fields";
import type { z } from "zod";

const approvalField = CLAUDE_POLICY_GROUPS[0]!.fields[0]!;
const commandFields = CLAUDE_POLICY_GROUPS[1]!.fields;
const policyGroups = [
  {
    title: "Approval mode",
    description: "Permission prompts and automatic approvals.",
    fields: [approvalField],
    guidance:
      "Changes apply only to new and forked sessions. Resumed and imported sessions use native Claude settings.",
  },
  {
    title: "Bash sandbox",
    description: "Command isolation for Bash and its child processes.",
    fields: [commandFields[0]!],
  },
  {
    title: "Command options",
    description: "Automatic approval, outside-sandbox requests, and excluded commands.",
    fields: commandFields.slice(1),
  },
  {
    ...CLAUDE_POLICY_GROUPS[2]!,
    description:
      "Allow, Ask, and Deny rules for tools, commands, files, domains, MCP, and subagents.",
    guidance:
      "Spec, Planner, and QA keep read-only tool and worktree limits. All roles and subagents keep their workflow-tool limits.",
  },
  {
    ...CLAUDE_POLICY_GROUPS[3]!,
    description: "Additional paths and read or write restrictions for sandboxed commands.",
  },
  {
    ...CLAUDE_POLICY_GROUPS[4]!,
    description: "Domains, local ports, and Unix sockets for sandboxed commands.",
  },
];

function ClaudePolicyGroup({
  group,
  config,
  disabled,
  errors,
  onChange,
}: {
  group: { title: string; description: string; fields: ClaudePolicyField[]; guidance?: string };
  config: ClaudeRuntimeConfig;
  disabled: boolean;
  errors: z.ZodIssue[];
  onChange: (config: ClaudeRuntimeConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  const groupErrors = errors.filter((issue) =>
    group.fields.some((field) => {
      const path = issue.path.slice(issue.path[0] === "defaults" ? 1 : 2).join(".");
      return path === field.path || path.startsWith(`${field.path}.`);
    }),
  );
  const defaultCount = group.fields.filter(
    (field) => readClaudePolicyField(config.defaults, field.path) !== undefined,
  ).length;
  const roleCount = CLAUDE_POLICY_ROLES.reduce(
    (count, role) =>
      count +
      group.fields.filter(
        (field) =>
          readClaudePolicyField(config.roleOverrides[role] ?? {}, field.path) !== undefined,
      ).length,
    0,
  );
  const expanded = open || groupErrors.length > 0;
  let summary = "Native settings";
  if (defaultCount || roleCount)
    summary = `Defaults: ${defaultCount} · Role overrides: ${roleCount}`;
  return (
    <Collapsible
      open={expanded}
      onOpenChange={setOpen}
      className="min-w-0 rounded-lg border border-border bg-card"
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full justify-between gap-3 whitespace-normal rounded-lg p-4 text-left"
          aria-label={group.title}
          disabled={disabled}
        >
          <span className="flex min-w-0 flex-col gap-1">
            <span className="text-base font-semibold">{group.title}</span>
            <span className="text-sm font-normal text-muted-foreground">{group.description}</span>
            <span className="text-xs font-normal text-muted-foreground">{summary}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {groupErrors.length > 0 && <Badge variant="danger">{groupErrors.length} errors</Badge>}
            <ChevronDown
              className={cn("transition-transform duration-150", expanded && "rotate-180")}
            />
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent
        forceMount
        hidden={!expanded}
        className="flex flex-col gap-5 border-t border-border p-4 data-[state=closed]:hidden"
      >
        {group.guidance && <p className="text-sm text-muted-foreground">{group.guidance}</p>}
        {group.fields.map((field) => (
          <ClaudePolicyCard
            key={field.path}
            field={field}
            config={config}
            disabled={disabled}
            errors={errors}
            onChange={onChange}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ClaudePolicySection({
  config,
  disabled,
  onChange,
  requiresAcknowledgement,
  acknowledged,
  onAcknowledgedChange,
}: {
  config: ClaudeRuntimeConfig;
  disabled: boolean;
  onChange: (config: ClaudeRuntimeConfig) => void;
  requiresAcknowledgement: boolean;
  acknowledged: boolean;
  onAcknowledgedChange: (value: boolean) => void;
}) {
  const id = useId();
  const validation = claudeRuntimeConfigSchema.safeParse(config);
  const errors = validation.success ? [] : validation.error.issues;
  return (
    <div className="grid min-w-0 gap-5">
      {requiresAcknowledgement && (
        <div className="flex flex-col gap-3 rounded-lg border border-warning-border bg-warning-surface p-4 text-warning-surface-foreground">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold">Confirm reduced Claude protections</p>
            <p className="max-w-3xl text-sm leading-6 text-pretty">
              Bypass removes routine permission prompts. Disabling the sandbox removes command
              isolation. Native mandatory restrictions and OpenDucktor role limits still apply.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id={`${id}-ack`}
              checked={acknowledged}
              disabled={disabled}
              onCheckedChange={onAcknowledgedChange}
            />
            <Label htmlFor={`${id}-ack`}>
              I understand these Claude settings reduce safety protections.
            </Label>
          </div>
        </div>
      )}
      {policyGroups.map((group) => (
        <ClaudePolicyGroup
          key={group.title}
          group={group}
          config={config}
          disabled={disabled}
          errors={errors}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

import type { AgentRole, ClaudeRuntimeConfig } from "@openducktor/contracts";
import { resolveClaudePolicy } from "@openducktor/contracts";
import { useId, useState } from "react";
import { z } from "zod";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { AGENT_ROLE_LABELS } from "@/types/agent-role-labels";
import { ClaudeListEditor } from "./settings-claude-list-editor";
import { readClaudePolicyField, updateClaudePolicyField } from "./settings-claude-policy";
import { CLAUDE_PERMISSION_MODES, type ClaudePolicyField } from "./settings-claude-policy-fields";
import {
  RuntimePolicyCard,
  RuntimePolicyDefault,
  RuntimePolicyInfo,
  RuntimePolicyRoleOverrides,
} from "./settings-runtime-policy-layout";

export const CLAUDE_POLICY_ROLES: AgentRole[] = ["spec", "planner", "build", "qa"];
type Scope = "defaults" | AgentRole;
type PolicyValue = string | boolean | string[] | undefined;

function valueLabel(value: PolicyValue): string {
  if (value === undefined) return "Native Claude settings";
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? "entry" : "entries"}`;
  if (value === true) return "On";
  if (value === false) return "Off";
  return CLAUDE_PERMISSION_MODES.find((mode) => mode.value === value)?.label ?? value;
}

function FieldControl({
  id,
  field,
  scope,
  value,
  disabled,
  onChange,
}: {
  id: string;
  field: ClaudePolicyField;
  scope: Scope;
  value: PolicyValue;
  disabled: boolean;
  onChange: (value: PolicyValue) => void;
}) {
  const options = [
    {
      value: "inherit",
      label: scope === "defaults" ? "Use native settings" : "Inherited",
      description:
        scope === "defaults"
          ? "Keep the value from native Claude settings."
          : "Use the OpenDucktor default for this field.",
    },
    ...(field.list
      ? [
          {
            value: "explicit",
            label: "Use this list",
            description:
              scope === "defaults"
                ? "Set OpenDucktor entries for this field. Native entries remain."
                : "Replace the OpenDucktor default list. Native entries remain.",
          },
        ]
      : field.path === "permissionMode"
        ? CLAUDE_PERMISSION_MODES
        : [
            { value: "true", label: "On" },
            { value: "false", label: "Off" },
          ]),
  ];
  let selected = "inherit";
  if (value !== undefined) selected = field.list ? "explicit" : String(value);
  return (
    <Combobox
      value={selected}
      options={options}
      disabled={disabled}
      triggerAriaLabelledBy={`${id}-label`}
      triggerClassName="h-10"
      wrapOptionLabels
      onValueChange={(next) => {
        if (next === "inherit") onChange(undefined);
        else if (field.list) {
          if (value === undefined) onChange([]);
        } else if (field.path === "permissionMode") onChange(next);
        else onChange(next === "true");
      }}
    />
  );
}

function FieldEntries({
  id,
  field,
  label,
  value,
  issues,
  disabled,
  onChange,
}: {
  id: string;
  field: ClaudePolicyField;
  label: string;
  value: PolicyValue;
  issues: z.ZodIssue[];
  disabled: boolean;
  onChange: (value: PolicyValue) => void;
}) {
  const entries = field.list && value !== undefined ? z.array(z.string()).parse(value) : null;
  return (
    <>
      {entries !== null && (
        <ClaudeListEditor
          id={id}
          label={label}
          value={entries}
          disabled={disabled}
          rules={field.path.startsWith("permissions.")}
          action={field.path.split(".")[1]}
          invalidIndices={entries.flatMap((_, index) =>
            issues.some((issue) => issue.path.at(-1) === index) ? [index] : [],
          )}
          onChange={onChange}
        />
      )}
      {issues.map((issue) => (
        <p
          key={`${issue.path.join(".")}:${issue.message}`}
          role="alert"
          className="text-sm text-destructive"
        >
          {issue.path.join(".")}: {issue.message}
        </p>
      ))}
    </>
  );
}

export function ClaudePolicyCard({
  field,
  config,
  disabled,
  errors,
  onChange,
}: {
  field: ClaudePolicyField;
  config: ClaudeRuntimeConfig;
  disabled: boolean;
  errors: z.ZodIssue[];
  onChange: (config: ClaudeRuntimeConfig) => void;
}) {
  const id = useId();
  const [showRoles, setShowRoles] = useState(false);
  const hasOverride = CLAUDE_POLICY_ROLES.some(
    (role) => readClaudePolicyField(config.roleOverrides[role] ?? {}, field.path) !== undefined,
  );
  const rolesVisible = showRoles || hasOverride;
  const defaultValue = readClaudePolicyField(config.defaults, field.path);
  const change = (scope: Scope, value: PolicyValue) => {
    if (scope === "defaults")
      onChange({
        ...config,
        defaults: updateClaudePolicyField(config.defaults, field.path, value),
      });
    else
      onChange({
        ...config,
        roleOverrides: {
          ...config.roleOverrides,
          [scope]: updateClaudePolicyField(config.roleOverrides[scope] ?? {}, field.path, value),
        },
      });
  };
  const issuesFor = (scope: Scope) => {
    const prefix =
      scope === "defaults" ? `defaults.${field.path}` : `roleOverrides.${scope}.${field.path}`;
    return errors.filter(
      (issue) => issue.path.join(".") === prefix || issue.path.join(".").startsWith(`${prefix}.`),
    );
  };
  const defaultId = `${id}-default`;
  return (
    <RuntimePolicyCard title={field.label}>
      <RuntimePolicyInfo>
        <p id={`${defaultId}-help`} className="max-w-3xl text-sm leading-6 text-pretty">
          {field.help}
        </p>
        {field.path === "permissionMode" && (
          <dl className="grid gap-1.5 border-info-border/70 border-t pt-2 text-sm">
            {CLAUDE_PERMISSION_MODES.map((mode) => (
              <div
                key={mode.value}
                className="grid gap-1 @min-[34rem]:grid-cols-[10rem_minmax(0,1fr)]"
              >
                <dt className="font-semibold">{mode.label}</dt>
                <dd className="leading-relaxed text-foreground/80">{mode.description}</dd>
              </div>
            ))}
          </dl>
        )}
      </RuntimePolicyInfo>
      <RuntimePolicyDefault
        labelId={`${defaultId}-label`}
        label={`Default ${field.label.toLowerCase()}`}
      >
        <FieldControl
          id={defaultId}
          field={field}
          scope="defaults"
          value={defaultValue}
          disabled={disabled}
          onChange={(value) => change("defaults", value)}
        />
        {((field.list && defaultValue !== undefined) || issuesFor("defaults").length > 0) && (
          <div className="flex min-w-0 flex-col gap-2 @min-[34rem]:col-span-2">
            <FieldEntries
              id={defaultId}
              field={field}
              label={`Default ${field.label.toLowerCase()}`}
              value={defaultValue}
              issues={issuesFor("defaults")}
              disabled={disabled}
              onChange={(value) => change("defaults", value)}
            />
          </div>
        )}
      </RuntimePolicyDefault>
      <RuntimePolicyRoleOverrides
        id={`${id}-roles`}
        label={field.label}
        enabled={rolesVisible}
        disabled={disabled}
        onEnabledChange={(enabled) => {
          setShowRoles(enabled);
          if (!enabled) {
            const roleOverrides = { ...config.roleOverrides };
            for (const role of CLAUDE_POLICY_ROLES) {
              if (roleOverrides[role])
                roleOverrides[role] = updateClaudePolicyField(
                  roleOverrides[role],
                  field.path,
                  undefined,
                );
            }
            onChange({ ...config, roleOverrides });
          }
        }}
      >
        <div className="divide-y divide-border rounded-md border border-border">
          {CLAUDE_POLICY_ROLES.map((role) => {
            const roleId = `${id}-${role}`;
            const label = `${AGENT_ROLE_LABELS[role]} ${field.label.toLowerCase()}`;
            const value = readClaudePolicyField(config.roleOverrides[role] ?? {}, field.path);
            const effective = readClaudePolicyField(
              resolveClaudePolicy(config, role).settings,
              field.path,
            );
            return (
              <div
                key={role}
                className="grid gap-2 px-3 py-2.5 @min-[28rem]:grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)] @min-[28rem]:items-center"
              >
                <div className="flex flex-col gap-1">
                  <Label id={`${roleId}-label`} className="text-sm font-medium text-foreground">
                    {AGENT_ROLE_LABELS[role]}
                    <span className="sr-only"> {field.label.toLowerCase()}</span>
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {effective === undefined
                      ? "Native Claude settings"
                      : `${value === undefined ? "Default" : "Override"}: ${valueLabel(effective)}`}
                  </p>
                </div>
                <FieldControl
                  id={roleId}
                  field={field}
                  scope={role}
                  value={value}
                  disabled={disabled}
                  onChange={(next) => change(role, next)}
                />
                {((field.list && value !== undefined) || issuesFor(role).length > 0) && (
                  <div className="flex min-w-0 flex-col gap-2 @min-[28rem]:col-span-2">
                    <p id={`${roleId}-help`} className="sr-only">
                      {field.help}
                    </p>
                    <FieldEntries
                      id={roleId}
                      field={field}
                      label={label}
                      value={value}
                      issues={issuesFor(role)}
                      disabled={disabled}
                      onChange={(next) => change(role, next)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </RuntimePolicyRoleOverrides>
    </RuntimePolicyCard>
  );
}

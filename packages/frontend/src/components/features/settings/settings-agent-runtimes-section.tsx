import {
  type AgentRuntimes,
  CODEX_APPROVAL_POLICY_VALUES,
  CODEX_APPROVALS_REVIEWER_VALUES,
  CODEX_SANDBOX_MODE_VALUES,
  type CodexPolicyFields,
  type CodexRuntimeConfig,
  DEFAULT_CODEX_RUNTIME_POLICY,
  type RuntimeDescriptor,
  type RuntimeKind,
  resolveCodexEffectivePolicy,
} from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { AGENT_ROLE_LABELS } from "@/types/agent-role-labels";
import { codexHasDangerousSelection } from "./settings-codex-risk-policy";

type AgentRuntimesSectionProps = {
  agentRuntimes: AgentRuntimes;
  runtimeDefinitions: RuntimeDescriptor[];
  disabled: boolean;
  isCodexDangerAcknowledged: boolean;
  onCodexDangerAcknowledgedChange: (acknowledged: boolean) => void;
  onUpdateAgentRuntimes: (updater: (current: AgentRuntimes) => AgentRuntimes) => void;
};

type CodexPolicyField = keyof CodexPolicyFields;

const AGENT_ROLE_ORDER: AgentRole[] = ["spec", "planner", "build", "qa"];

const POLICY_LABELS = {
  sandboxMode: "Sandbox mode",
  approvalPolicy: "Approval prompts",
  approvalsReviewer: "Prompt reviewer",
  workspaceWriteNetworkAccess: "Command network access",
} satisfies Record<CodexPolicyField, string>;

const VALUE_LABELS = {
  "read-only": "Read-only",
  "workspace-write": "Workspace-write",
  "danger-full-access": "Danger full access",
  untrusted: "Untrusted",
  "on-request": "On request",
  never: "Never",
  user: "User",
  auto_review: "Auto review",
  true: "On",
  false: "Off",
} satisfies Record<string, string>;

const VALUE_HELP = {
  "read-only": "Codex can inspect files but cannot change the workspace.",
  "workspace-write": "Codex can edit files in the workspace while keeping sandbox boundaries.",
  "danger-full-access": "Codex runs without sandbox boundaries. Use only for trusted tasks.",
  untrusted: "Codex asks before writes or commands that need trust.",
  "on-request": "Codex asks when it decides a command needs approval.",
  never: "Codex does not ask for approval prompts.",
  user: "Approval prompts go to the user.",
  auto_review: "Eligible prompts go through Codex automatic review.",
  true: "Allow network for commands when sandbox mode is workspace-write.",
  false: "Keep command network blocked when sandbox mode is workspace-write.",
} satisfies Record<string, string>;

const FEATURE_HELP = {
  sandboxMode:
    "Choose the filesystem sandbox Codex starts with. Use danger-full-access only when this repository and task are trusted.",
  approvalPolicy:
    "Choose when Codex asks before proceeding. Never removes approval prompts and requires acknowledgement before saving.",
  approvalsReviewer:
    "Choose who reviews approval prompts. This setting is ignored while approval policy is never.",
  workspaceWriteNetworkAccess:
    "Allow commands launched inside workspace-write to use the network. Other sandbox modes ignore this switch.",
} satisfies Record<CodexPolicyField, string>;

const FEATURE_FIELDS: CodexPolicyField[] = [
  "sandboxMode",
  "approvalPolicy",
  "approvalsReviewer",
  "workspaceWriteNetworkAccess",
];

const defaultValuesForField = <Field extends CodexPolicyField>(
  field: Field,
): CodexPolicyFields[Field][] => {
  if (field === "sandboxMode") return [...CODEX_SANDBOX_MODE_VALUES] as CodexPolicyFields[Field][];
  if (field === "approvalPolicy")
    return [...CODEX_APPROVAL_POLICY_VALUES] as CodexPolicyFields[Field][];
  if (field === "approvalsReviewer")
    return [...CODEX_APPROVALS_REVIEWER_VALUES] as CodexPolicyFields[Field][];
  return [false, true] as CodexPolicyFields[Field][];
};

const sortRuntimeDefinitionsForSettings = (
  runtimeDefinitions: RuntimeDescriptor[],
): RuntimeDescriptor[] => {
  return runtimeDefinitions.toSorted((left, right) => {
    if (left.kind === "opencode") {
      return -1;
    }
    if (right.kind === "opencode") {
      return 1;
    }
    return left.label.localeCompare(right.label);
  });
};

const codexConfigWithDefaults = (config: CodexRuntimeConfig): CodexRuntimeConfig => ({
  enabled: config.enabled,
  defaults: { ...DEFAULT_CODEX_RUNTIME_POLICY, ...config.defaults },
  roleOverrides: config.roleOverrides ?? {},
});

const removeUndefinedFields = (
  override: { [Field in CodexPolicyField]?: CodexPolicyFields[Field] | undefined },
): Partial<CodexPolicyFields> => {
  const next: Partial<CodexPolicyFields> = {};
  for (const field of Object.keys(override) as CodexPolicyField[]) {
    if (override[field] !== undefined) {
      next[field] = override[field] as never;
    }
  }
  return next;
};

const valueKey = (value: string | boolean): keyof typeof VALUE_LABELS =>
  String(value) as keyof typeof VALUE_LABELS;

function PolicyOptionCards<T extends string | boolean>({
  value,
  values,
  disabled,
  onChange,
  includeInherit,
  inheritedLabel,
}: {
  value: T | undefined;
  values: T[];
  disabled: boolean;
  onChange: (value: T | undefined) => void;
  includeInherit?: boolean;
  inheritedLabel?: string;
}): ReactElement {
  return (
    <div className="grid gap-2 md:grid-cols-3">
      {includeInherit ? (
        <button
          type="button"
          aria-pressed={value === undefined}
          disabled={disabled}
          onClick={() => onChange(undefined)}
          className={cn(
            "rounded-md border px-3 py-2.5 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            value === undefined
              ? "border-primary bg-primary/10 text-foreground shadow-sm"
              : "border-border bg-background text-muted-foreground hover:bg-muted/70",
          )}
        >
          <span className="block text-sm font-semibold text-foreground">Inherit default</span>
          <span className="mt-0.5 block leading-relaxed">
            Uses {inheritedLabel} unless role safety rules adjust it.
          </span>
        </button>
      ) : null}
      {values.map((option) => {
        const key = valueKey(option);
        const active = option === value;
        return (
          <button
            key={String(option)}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(option)}
            className={cn(
              "rounded-md border px-3 py-2.5 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              active
                ? "border-primary bg-primary/10 text-foreground shadow-sm"
                : "border-border bg-background text-muted-foreground hover:bg-muted/70",
            )}
          >
            <span className="block text-sm font-semibold text-foreground">{VALUE_LABELS[key]}</span>
            <span className="mt-0.5 block leading-relaxed">{VALUE_HELP[key]}</span>
          </button>
        );
      })}
    </div>
  );
}

function RuntimeOverview({
  definition,
  enabled,
  disabled,
  onToggle,
}: {
  definition: RuntimeDescriptor;
  enabled: boolean;
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
}): ReactElement {
  return (
    <div className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-[1fr_auto] sm:items-start">
      <div className="min-w-0 space-y-2">
        <h4 className="text-sm font-semibold text-foreground">{definition.label}</h4>
        <p className="text-xs text-muted-foreground">{definition.description}</p>
        <p className="text-xs text-muted-foreground">
          Supports {definition.capabilities.workflow.supportedScopes.join(", ")} workflow scopes.
        </p>
      </div>
      <div className="flex items-center gap-2 justify-self-start sm:justify-self-end">
        <Label htmlFor={`agent-runtime-${definition.kind}`} className="text-xs">
          Enable runtime
        </Label>
        <Switch
          id={`agent-runtime-${definition.kind}`}
          checked={enabled}
          disabled={disabled}
          onCheckedChange={onToggle}
        />
      </div>
    </div>
  );
}

function CodexSettings({
  config,
  disabled,
  isDangerAcknowledged,
  onDangerAcknowledgedChange,
  onUpdate,
}: {
  config: CodexRuntimeConfig;
  disabled: boolean;
  isDangerAcknowledged: boolean;
  onDangerAcknowledgedChange: (acknowledged: boolean) => void;
  onUpdate: (updater: (config: CodexRuntimeConfig) => CodexRuntimeConfig) => void;
}): ReactElement {
  const updateDefault = <Field extends CodexPolicyField>(
    field: Field,
    value: CodexPolicyFields[Field],
  ) =>
    onUpdate((current) => ({
      ...current,
      defaults: { ...current.defaults, [field]: value },
    }));

  const updateOverride = <Field extends CodexPolicyField>(
    role: AgentRole,
    field: Field,
    value: CodexPolicyFields[Field] | undefined,
  ) =>
    onUpdate((current) => {
      const draftRoleOverride = { ...(current.roleOverrides[role] ?? {}) };
      if (value === undefined) {
        delete draftRoleOverride[field];
      } else {
        draftRoleOverride[field] = value as never;
      }
      const nextRoleOverride = removeUndefinedFields(draftRoleOverride);
      const nextRoleOverrides = { ...current.roleOverrides };
      if (Object.keys(nextRoleOverride).length === 0) {
        delete nextRoleOverrides[role];
      } else {
        nextRoleOverrides[role] = nextRoleOverride;
      }
      return { ...current, roleOverrides: nextRoleOverrides };
    });

  return (
    <div className="grid gap-5">
      {FEATURE_FIELDS.map((field) => (
        <CodexFeatureGroup
          key={field}
          field={field}
          config={config}
          disabled={disabled}
          onDefaultChange={updateDefault}
          onOverrideChange={updateOverride}
        />
      ))}

      {codexHasDangerousSelection(config) ? (
        <div className="rounded-lg border border-destructive bg-card p-4 text-xs text-foreground space-y-3">
          <p>
            Acknowledgement required: danger-full-access removes sandbox boundaries, and never
            disables approval prompts. Save only after confirming this is intended.
          </p>
          <div className="flex items-center gap-2">
            <Switch
              id="codex-danger-acknowledgement"
              checked={isDangerAcknowledged}
              disabled={disabled}
              onCheckedChange={onDangerAcknowledgedChange}
            />
            <Label htmlFor="codex-danger-acknowledgement" className="text-xs text-foreground">
              I understand these Codex settings reduce safety protections.
            </Label>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CodexFeatureGroup<Field extends CodexPolicyField>({
  field,
  config,
  disabled,
  onDefaultChange,
  onOverrideChange,
}: {
  field: Field;
  config: CodexRuntimeConfig;
  disabled: boolean;
  onDefaultChange: <ChangeField extends CodexPolicyField>(
    field: ChangeField,
    value: CodexPolicyFields[ChangeField],
  ) => void;
  onOverrideChange: <ChangeField extends CodexPolicyField>(
    role: AgentRole,
    field: ChangeField,
    value: CodexPolicyFields[ChangeField] | undefined,
  ) => void;
}): ReactElement {
  const [selectedRole, setSelectedRole] = useState<AgentRole>("spec");
  const defaultValue = config.defaults[field];
  const override = config.roleOverrides[selectedRole]?.[field] as
    | CodexPolicyFields[Field]
    | undefined;
  const allowedValues = valuesForRole(field, selectedRole);
  const isNetworkAccess = field === "workspaceWriteNetworkAccess";

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-4">
      <div className="space-y-1.5">
        <h4 className="text-base font-semibold text-foreground">{POLICY_LABELS[field]}</h4>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {FEATURE_HELP[field]}
        </p>
      </div>
      <div className="space-y-2.5 rounded-lg border border-border bg-background p-3">
        <div className="space-y-0.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Default
          </Label>
          <p className="text-xs text-muted-foreground">
            Used by every role unless that role overrides it.
          </p>
        </div>
        {isNetworkAccess ? (
          <NetworkAccessSwitch
            value={defaultValue as boolean}
            disabled={disabled}
            onChange={(value) => onDefaultChange(field, value as CodexPolicyFields[Field])}
          />
        ) : (
          <PolicyOptionCards
            value={defaultValue as string}
            values={defaultValuesForField(field) as string[]}
            disabled={disabled}
            onChange={(value) =>
              value !== undefined && onDefaultChange(field, value as CodexPolicyFields[Field])
            }
          />
        )}
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
        <div className="space-y-0.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Role override
          </Label>
          <p className="text-xs text-muted-foreground">
            Pick a role, then either inherit or set a role-specific value.
          </p>
        </div>
        <RoleTabs value={selectedRole} onChange={setSelectedRole} disabled={disabled} />
        {isNetworkAccess ? (
          <NetworkAccessOverride
            value={override as boolean | undefined}
            inheritedValue={defaultValue as boolean}
            disabled={disabled}
            onChange={(value) =>
              onOverrideChange(selectedRole, field, value as CodexPolicyFields[Field] | undefined)
            }
          />
        ) : (
          <PolicyOptionCards
            value={override as string | undefined}
            values={allowedValues as string[]}
            disabled={disabled}
            includeInherit
            inheritedLabel={VALUE_LABELS[valueKey(defaultValue)]}
            onChange={(value) =>
              onOverrideChange(selectedRole, field, value as CodexPolicyFields[Field] | undefined)
            }
          />
        )}
        <EffectivePolicyMessage config={config} role={selectedRole} field={field} />
      </div>
    </div>
  );
}

function NetworkAccessSwitch({
  value,
  disabled,
  onChange,
}: {
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}): ReactElement {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-card px-3 py-2.5">
      <div className="space-y-0.5">
        <p className="text-sm font-semibold text-foreground">Command network access</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {value ? VALUE_HELP.true : VALUE_HELP.false}
        </p>
      </div>
      <Switch
        checked={value}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label="Command network access"
      />
    </div>
  );
}

function NetworkAccessOverride({
  value,
  inheritedValue,
  disabled,
  onChange,
}: {
  value: boolean | undefined;
  inheritedValue: boolean;
  disabled: boolean;
  onChange: (value: boolean | undefined) => void;
}): ReactElement {
  const isInherited = value === undefined;
  return (
    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <button
        type="button"
        aria-pressed={isInherited}
        disabled={disabled}
        onClick={() => onChange(undefined)}
        className={cn(
          "rounded-md border px-3 py-2.5 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60",
          isInherited
            ? "border-primary bg-primary/10 text-foreground shadow-sm"
            : "border-border bg-background text-muted-foreground hover:bg-muted/70",
        )}
      >
        <span className="block text-sm font-semibold text-foreground">Inherit default</span>
        <span className="mt-0.5 block leading-relaxed">
          Uses {VALUE_LABELS[valueKey(inheritedValue)]} for this role.
        </span>
      </button>
      <div className="rounded-md border border-border bg-background px-3 py-2.5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-foreground">Override network access</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {value === true ? VALUE_HELP.true : VALUE_HELP.false}
            </p>
          </div>
          <Switch
            checked={value ?? inheritedValue}
            disabled={disabled}
            onCheckedChange={onChange}
            aria-label="Override command network access"
          />
        </div>
      </div>
    </div>
  );
}

function RoleTabs({
  value,
  onChange,
  disabled,
}: {
  value: AgentRole;
  onChange: (role: AgentRole) => void;
  disabled: boolean;
}): ReactElement {
  return (
    <div
      className="grid grid-cols-2 gap-1 rounded-md border border-border bg-background p-1 sm:grid-cols-4"
      role="tablist"
      aria-label="Codex role tabs"
    >
      {AGENT_ROLE_ORDER.map((role) => (
        <button
          key={role}
          type="button"
          role="tab"
          aria-selected={value === role}
          disabled={disabled}
          onClick={() => onChange(role)}
          className={cn(
            "rounded-sm px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            value === role
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {AGENT_ROLE_LABELS[role]}
        </button>
      ))}
    </div>
  );
}

function valuesForRole<Field extends CodexPolicyField>(
  field: Field,
  role: AgentRole,
): CodexPolicyFields[Field][] {
  const values = defaultValuesForField(field);
  if (field === "sandboxMode") {
    if (role === "build") return values.filter((v) => v !== "read-only");
  }
  return values;
}

function EffectivePolicyMessage({
  config,
  role,
  field,
}: {
  config: CodexRuntimeConfig;
  role: AgentRole;
  field: CodexPolicyField;
}): ReactElement {
  let effective: ReturnType<typeof resolveCodexEffectivePolicy> | null = null;
  let effectiveError: string | null = null;
  try {
    effective = resolveCodexEffectivePolicy(config, role);
  } catch (error) {
    effectiveError = error instanceof Error ? error.message : String(error);
  }
  const effectiveValue = effective?.[field] ?? false;
  return (
    <div className="rounded-md border border-border bg-background p-2 text-xs text-muted-foreground">
      {effective ? (
        <>
          Effective for {AGENT_ROLE_LABELS[role]}: {VALUE_LABELS[valueKey(effectiveValue)]}.
          {effective.adjustmentReason ? ` ${effective.adjustmentReason}` : ""}
          {!effective.approvalsReviewerApplies
            ? " Reviewer is saved but has no effect while approval prompts are never."
            : ""}
        </>
      ) : (
        <span className="text-destructive">{effectiveError}</span>
      )}
    </div>
  );
}

export function AgentRuntimesSection({
  agentRuntimes,
  runtimeDefinitions,
  disabled,
  isCodexDangerAcknowledged,
  onCodexDangerAcknowledgedChange,
  onUpdateAgentRuntimes,
}: AgentRuntimesSectionProps): ReactElement {
  const sortedRuntimeDefinitions = sortRuntimeDefinitionsForSettings(runtimeDefinitions);
  const defaultTab = sortedRuntimeDefinitions[0]?.kind;
  const [selectedTab, setSelectedTab] = useState(defaultTab ?? "");
  const selectedDefinition =
    sortedRuntimeDefinitions.find((definition) => definition.kind === selectedTab) ??
    sortedRuntimeDefinitions[0];

  useEffect(() => {
    if (!defaultTab) {
      setSelectedTab("");
      return;
    }
    if (!sortedRuntimeDefinitions.some((definition) => definition.kind === selectedTab)) {
      setSelectedTab(defaultTab);
    }
  }, [defaultTab, selectedTab, sortedRuntimeDefinitions]);

  return (
    <div className="grid gap-4 p-4">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Agent Runtimes</h3>
        <p className="text-xs text-muted-foreground">
          Disabled runtimes are not started automatically and must be enabled before new agent
          sessions can use them.
        </p>
      </div>

      {selectedDefinition ? (
        <div className="grid gap-4 overflow-hidden rounded-md border border-border bg-card md:grid-cols-[14rem_minmax(0,1fr)]">
          <aside className="border-border bg-muted/50 p-3 md:border-r">
            <div className="space-y-1" role="tablist">
              {sortedRuntimeDefinitions.map((definition) => {
                const runtimeKind = definition.kind as RuntimeKind;
                const enabled = agentRuntimes[runtimeKind]?.enabled === true;
                const tabId = `agent-runtime-tab-${definition.kind}`;
                const panelId = `agent-runtime-panel-${definition.kind}`;
                return (
                  <Button
                    key={definition.kind}
                    id={tabId}
                    type="button"
                    role="tab"
                    aria-controls={panelId}
                    aria-selected={selectedDefinition.kind === definition.kind}
                    variant="ghost"
                    className={cn(
                      "w-full justify-between gap-3 border text-left",
                      selectedDefinition.kind === definition.kind
                        ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                        : "border-transparent text-muted-foreground hover:bg-background hover:text-foreground",
                    )}
                    disabled={disabled}
                    onClick={() => setSelectedTab(definition.kind)}
                  >
                    <span className="truncate">{definition.label}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "shrink-0 border",
                        enabled
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/60 dark:text-emerald-300"
                          : "border-border bg-muted text-muted-foreground",
                      )}
                    >
                      {enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </Button>
                );
              })}
            </div>
          </aside>

          {(() => {
            const runtimeKind = selectedDefinition.kind as RuntimeKind;
            const enabled = agentRuntimes[runtimeKind]?.enabled === true;
            const updateRuntime = (
              updater: (config: AgentRuntimes[RuntimeKind]) => AgentRuntimes[RuntimeKind],
            ) =>
              onUpdateAgentRuntimes((current) => ({
                ...current,
                [runtimeKind]: updater(current[runtimeKind]),
              }));

            return (
              <div
                id={`agent-runtime-panel-${selectedDefinition.kind}`}
                role="tabpanel"
                aria-labelledby={`agent-runtime-tab-${selectedDefinition.kind}`}
                className="min-w-0 space-y-4 p-3"
              >
                <RuntimeOverview
                  definition={selectedDefinition}
                  enabled={enabled}
                  disabled={disabled}
                  onToggle={(nextEnabled) =>
                    onUpdateAgentRuntimes((current) => ({
                      ...current,
                      [runtimeKind]: {
                        ...(current[runtimeKind] ?? {}),
                        enabled: nextEnabled,
                      },
                    }))
                  }
                />
                {selectedDefinition.kind === "codex" ? (
                  <CodexSettings
                    config={codexConfigWithDefaults(agentRuntimes.codex)}
                    disabled={disabled}
                    isDangerAcknowledged={isCodexDangerAcknowledged}
                    onDangerAcknowledgedChange={onCodexDangerAcknowledgedChange}
                    onUpdate={(updater) =>
                      updateRuntime((current) =>
                        updater(codexConfigWithDefaults(current as CodexRuntimeConfig)),
                      )
                    }
                  />
                ) : null}
              </div>
            );
          })()}
        </div>
      ) : (
        <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
          No runtimes are available.
        </div>
      )}
    </div>
  );
}

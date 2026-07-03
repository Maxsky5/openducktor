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
import { Combobox } from "@/components/ui/combobox";
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

const INHERIT_ROLE_OVERRIDE_VALUE = "__inherit__";

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

const policyValueFromOption = <T extends string | boolean>(values: T[], nextValue: string): T => {
  const selectedValue = values.find((value) => String(value) === nextValue);
  if (selectedValue === undefined) {
    throw new Error(`Unknown Codex policy value: ${nextValue}`);
  }
  return selectedValue;
};

const hasRoleOverrideForField = (config: CodexRuntimeConfig, field: CodexPolicyField): boolean =>
  AGENT_ROLE_ORDER.some((role) => config.roleOverrides[role]?.[field] !== undefined);

function PolicyValueDropdown<T extends string | boolean>({
  value,
  values,
  disabled,
  labelId,
  onChange,
}: {
  value: T;
  values: T[];
  disabled: boolean;
  labelId: string;
  onChange: (value: T) => void;
}): ReactElement {
  const options = values.map((option) => {
    const key = valueKey(option);
    return {
      value: String(option),
      label: VALUE_LABELS[key],
      description: VALUE_HELP[key],
    };
  });

  return (
    <div className="flex flex-col gap-1">
      <Combobox
        value={String(value)}
        options={options}
        disabled={disabled}
        triggerAriaLabelledBy={labelId}
        searchPlaceholder="Search options..."
        emptyText="No option found."
        triggerClassName="h-10"
        wrapOptionLabels
        onValueChange={(nextValue) => onChange(policyValueFromOption(values, nextValue))}
      />
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
  const [openRoleOverrideFields, setOpenRoleOverrideFields] = useState<
    Partial<Record<CodexPolicyField, boolean>>
  >({});

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

  const updateRoleOverridesEnabled = <Field extends CodexPolicyField>(
    field: Field,
    enabled: boolean,
  ) => {
    setOpenRoleOverrideFields((current) => ({ ...current, [field]: enabled }));
    if (enabled) {
      return;
    }

    onUpdate((current) => {
      const nextRoleOverrides = { ...current.roleOverrides };

      for (const role of AGENT_ROLE_ORDER) {
        const draftRoleOverride = { ...(nextRoleOverrides[role] ?? {}) };
        delete draftRoleOverride[field];

        const nextRoleOverride = removeUndefinedFields(draftRoleOverride);
        if (Object.keys(nextRoleOverride).length === 0) {
          delete nextRoleOverrides[role];
        } else {
          nextRoleOverrides[role] = nextRoleOverride;
        }
      }

      return { ...current, roleOverrides: nextRoleOverrides };
    });
  };

  return (
    <div className="grid gap-5">
      {FEATURE_FIELDS.map((field) => (
        <CodexFeatureGroup
          key={field}
          field={field}
          config={config}
          disabled={disabled}
          roleOverridesVisible={
            openRoleOverrideFields[field] === true || hasRoleOverrideForField(config, field)
          }
          onDefaultChange={updateDefault}
          onOverrideChange={updateOverride}
          onRoleOverridesEnabledChange={updateRoleOverridesEnabled}
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
  roleOverridesVisible,
  onDefaultChange,
  onOverrideChange,
  onRoleOverridesEnabledChange,
}: {
  field: Field;
  config: CodexRuntimeConfig;
  disabled: boolean;
  roleOverridesVisible: boolean;
  onDefaultChange: <ChangeField extends CodexPolicyField>(
    field: ChangeField,
    value: CodexPolicyFields[ChangeField],
  ) => void;
  onOverrideChange: <ChangeField extends CodexPolicyField>(
    role: AgentRole,
    field: ChangeField,
    value: CodexPolicyFields[ChangeField] | undefined,
  ) => void;
  onRoleOverridesEnabledChange: <ChangeField extends CodexPolicyField>(
    field: ChangeField,
    enabled: boolean,
  ) => void;
}): ReactElement {
  const defaultValue = config.defaults[field];
  const defaultLabelId = `codex-${field}-default-label`;
  const roleOverrideSwitchId = `codex-${field}-role-overrides`;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-1">
        <h4 className="text-base font-semibold text-foreground">{POLICY_LABELS[field]}</h4>
        <p className="text-sm text-muted-foreground">
          Configure the default value, then opt into role-specific overrides only when needed.
        </p>
      </div>

      <PolicyInfoPanel field={field} />

      <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-[minmax(0,1fr)_minmax(14rem,18rem)] sm:items-center">
        <div className="flex flex-col gap-1">
          <Label id={defaultLabelId} className="text-sm font-medium text-foreground">
            Default {POLICY_LABELS[field].toLowerCase()}
          </Label>
          <p className="text-xs text-muted-foreground">
            Used by every role unless that role overrides it.
          </p>
        </div>
        <PolicyValueDropdown
          value={defaultValue}
          values={defaultValuesForField(field)}
          disabled={disabled}
          labelId={defaultLabelId}
          onChange={(value) => onDefaultChange(field, value as CodexPolicyFields[Field])}
        />
      </div>

      <EffectivePolicyNotes config={config} field={field} />

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor={roleOverrideSwitchId} className="text-sm font-medium text-foreground">
              Role overrides
            </Label>
            <p className="text-xs text-muted-foreground">
              Enable this only when a role needs a different value for this setting.
            </p>
          </div>
          <Switch
            id={roleOverrideSwitchId}
            checked={roleOverridesVisible}
            disabled={disabled}
            onCheckedChange={(enabled) => onRoleOverridesEnabledChange(field, enabled)}
            aria-label={`Enable ${POLICY_LABELS[field]} role overrides`}
          />
        </div>

        {roleOverridesVisible ? (
          <RoleOverrideRows
            field={field}
            config={config}
            disabled={disabled}
            onOverrideChange={onOverrideChange}
          />
        ) : null}
      </div>
    </div>
  );
}

function PolicyInfoPanel<Field extends CodexPolicyField>({
  field,
}: {
  field: Field;
}): ReactElement {
  const values = defaultValuesForField(field);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-info-border bg-info-surface px-3 py-2.5 text-info-surface-foreground">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">About this setting</p>
        <p className="max-w-3xl text-sm leading-relaxed text-pretty">{FEATURE_HELP[field]}</p>
      </div>
      <dl className="flex flex-col gap-1.5 text-sm">
        {values.map((option) => {
          const key = valueKey(option);
          return (
            <div key={String(option)} className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <dt className="font-medium">{VALUE_LABELS[key]}</dt>
              <dd className="leading-relaxed text-info-muted">{VALUE_HELP[key]}</dd>
            </div>
          );
        })}
        <div className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <dt className="font-medium">Inherited</dt>
          <dd className="leading-relaxed text-info-muted">
            Role override only. Leaves the role unset and uses the default value.
          </dd>
        </div>
      </dl>
    </div>
  );
}

function RoleOverrideRows<Field extends CodexPolicyField>({
  field,
  config,
  disabled,
  onOverrideChange,
}: {
  field: Field;
  config: CodexRuntimeConfig;
  disabled: boolean;
  onOverrideChange: <ChangeField extends CodexPolicyField>(
    role: AgentRole,
    field: ChangeField,
    value: CodexPolicyFields[ChangeField] | undefined,
  ) => void;
}): ReactElement {
  return (
    <div className="divide-y divide-border rounded-md border border-border">
      {AGENT_ROLE_ORDER.map((role) => {
        const roleLabelId = `codex-${field}-${role}-override-label`;
        const overrideValue = config.roleOverrides[role]?.[field] as
          | CodexPolicyFields[Field]
          | undefined;
        const rowDescription =
          overrideValue === undefined ? "Uses the default value." : "Override set for this role.";

        return (
          <div
            key={role}
            className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)] sm:items-center"
          >
            <div className="flex flex-col gap-0.5">
              <Label id={roleLabelId} className="text-sm font-medium text-foreground">
                {AGENT_ROLE_LABELS[role]}
              </Label>
              <p className="text-xs text-muted-foreground">{rowDescription}</p>
            </div>
            <RoleOverrideDropdown
              value={overrideValue}
              values={valuesForRole(field, role)}
              disabled={disabled}
              labelId={roleLabelId}
              onChange={(value) => onOverrideChange(role, field, value)}
            />
          </div>
        );
      })}
    </div>
  );
}

function RoleOverrideDropdown<T extends string | boolean>({
  value,
  values,
  disabled,
  labelId,
  onChange,
}: {
  value: T | undefined;
  values: T[];
  disabled: boolean;
  labelId: string;
  onChange: (value: T | undefined) => void;
}): ReactElement {
  const options = [
    {
      value: INHERIT_ROLE_OVERRIDE_VALUE,
      label: "Inherited",
      description: "Use the default value for this role.",
    },
    ...values.map((option) => {
      const key = valueKey(option);
      return {
        value: String(option),
        label: VALUE_LABELS[key],
        description: VALUE_HELP[key],
      };
    }),
  ];

  return (
    <Combobox
      value={value === undefined ? INHERIT_ROLE_OVERRIDE_VALUE : String(value)}
      options={options}
      disabled={disabled}
      triggerAriaLabelledBy={labelId}
      searchPlaceholder="Search options..."
      emptyText="No option found."
      triggerClassName="h-10"
      wrapOptionLabels
      onValueChange={(nextValue) => {
        if (nextValue === INHERIT_ROLE_OVERRIDE_VALUE) {
          onChange(undefined);
          return;
        }
        onChange(policyValueFromOption(values, nextValue));
      }}
    />
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

function EffectivePolicyNotes({
  config,
  field,
}: {
  config: CodexRuntimeConfig;
  field: CodexPolicyField;
}): ReactElement | null {
  const notes: string[] = [];
  const errors: string[] = [];
  let reviewerIsInactive = false;

  for (const role of AGENT_ROLE_ORDER) {
    try {
      const effective = resolveCodexEffectivePolicy(config, role);
      const effectiveValue = effective[field] ?? false;

      if (field === "sandboxMode" && effective.adjustmentReason) {
        notes.push(
          `Effective for ${AGENT_ROLE_LABELS[role]}: ${VALUE_LABELS[valueKey(effectiveValue)]}. ${effective.adjustmentReason}`,
        );
      }
      if (field === "approvalsReviewer" && !effective.approvalsReviewerApplies) {
        reviewerIsInactive = true;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${AGENT_ROLE_LABELS[role]}: ${message}`);
    }
  }

  if (reviewerIsInactive) {
    notes.push("Reviewer is saved but has no effect while approval prompts are never.");
  }

  if (notes.length === 0 && errors.length === 0) {
    return null;
  }

  return (
    <div className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
      {notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
      {errors.map((error) => (
        <p key={error} className="text-destructive">
          {error}
        </p>
      ))}
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

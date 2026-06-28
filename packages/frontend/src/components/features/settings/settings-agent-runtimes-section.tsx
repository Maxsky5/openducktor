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
import { SegmentedControlItem, SegmentedControlRoot } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
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
const READ_ONLY_AGENT_ROLES = new Set<AgentRole>(["spec", "planner", "qa"]);

const POLICY_LABELS: Record<CodexPolicyField, string> = {
  sandboxMode: "Sandbox mode",
  approvalPolicy: "Approval prompts",
  approvalsReviewer: "Prompt reviewer",
  workspaceWriteNetworkAccess: "Command network access",
};

const VALUE_LABELS: Record<string, string> = {
  "read-only": "read-only",
  "workspace-write": "workspace-write",
  "danger-full-access": "danger-full-access",
  untrusted: "untrusted",
  "on-request": "on-request",
  never: "never",
  user: "user",
  auto_review: "auto_review",
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

function PolicyOptionButtons<T extends string | boolean>({
  value,
  values,
  disabled,
  onChange,
}: {
  value: T;
  values: T[];
  disabled: boolean;
  onChange: (value: T) => void;
}): ReactElement {
  return (
    <SegmentedControlRoot className="flex-wrap" size="sm">
      {values.map((option) => (
        <SegmentedControlItem
          key={String(option)}
          active={option === value}
          disabled={disabled}
          onClick={() => onChange(option)}
        >
          {typeof option === "boolean" ? (option ? "on" : "off") : VALUE_LABELS[String(option)]}
        </SegmentedControlItem>
      ))}
    </SegmentedControlRoot>
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
    <div className="grid gap-3 rounded-md border border-border bg-card p-3 sm:grid-cols-[1fr_auto] sm:items-start">
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
    <div className="grid gap-4">
      <div className="rounded-md border border-border bg-card p-3 space-y-3">
        <h4 className="text-sm font-semibold text-foreground">Codex defaults</h4>
        <CodexPolicyControls
          policy={config.defaults}
          disabled={disabled}
          onChange={updateDefault}
        />
        <p className="text-xs text-muted-foreground">
          Command network access applies only to commands spawned by Codex while using
          workspace-write. It does not change OpenDucktor host or network access.
        </p>
      </div>

      <div className="grid gap-3">
        {AGENT_ROLE_ORDER.map((role) => (
          <CodexRoleOverride
            key={role}
            role={role}
            config={config}
            disabled={disabled}
            onChange={updateOverride}
          />
        ))}
      </div>

      {codexHasDangerousSelection(config) ? (
        <div className="rounded-md border border-destructive bg-card p-3 text-xs text-foreground space-y-3">
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

      <div className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground space-y-1">
        <p>danger-full-access removes sandbox boundaries.</p>
        <p>never disables approval prompts.</p>
        <p>user routes approval prompts to the user.</p>
        <p>
          auto_review routes eligible prompts through Codex automatic review; it does not weaken the
          sandbox.
        </p>
      </div>
    </div>
  );
}

function CodexPolicyControls({
  policy,
  disabled,
  onChange,
}: {
  policy: CodexPolicyFields;
  disabled: boolean;
  onChange: <Field extends CodexPolicyField>(field: Field, value: CodexPolicyFields[Field]) => void;
}): ReactElement {
  return (
    <div className="grid gap-3">
      <PolicyRow label={POLICY_LABELS.sandboxMode}>
        <PolicyOptionButtons
          value={policy.sandboxMode}
          values={[...CODEX_SANDBOX_MODE_VALUES]}
          disabled={disabled}
          onChange={(value) => onChange("sandboxMode", value)}
        />
      </PolicyRow>
      <PolicyRow label={POLICY_LABELS.approvalPolicy}>
        <PolicyOptionButtons
          value={policy.approvalPolicy}
          values={[...CODEX_APPROVAL_POLICY_VALUES]}
          disabled={disabled}
          onChange={(value) => onChange("approvalPolicy", value)}
        />
      </PolicyRow>
      <PolicyRow label={POLICY_LABELS.approvalsReviewer}>
        <PolicyOptionButtons
          value={policy.approvalsReviewer}
          values={[...CODEX_APPROVALS_REVIEWER_VALUES]}
          disabled={disabled}
          onChange={(value) => onChange("approvalsReviewer", value)}
        />
      </PolicyRow>
      <PolicyRow label={POLICY_LABELS.workspaceWriteNetworkAccess}>
        <PolicyOptionButtons
          value={policy.workspaceWriteNetworkAccess}
          values={[false, true]}
          disabled={disabled}
          onChange={(value) => onChange("workspaceWriteNetworkAccess", value)}
        />
      </PolicyRow>
    </div>
  );
}

function CodexRoleOverride({
  role,
  config,
  disabled,
  onChange,
}: {
  role: AgentRole;
  config: CodexRuntimeConfig;
  disabled: boolean;
  onChange: <Field extends CodexPolicyField>(
    role: AgentRole,
    field: Field,
    value: CodexPolicyFields[Field] | undefined,
  ) => void;
}): ReactElement {
  const override = config.roleOverrides[role] ?? {};
  let effective: ReturnType<typeof resolveCodexEffectivePolicy> | null = null;
  let effectiveError: string | null = null;
  try {
    effective = resolveCodexEffectivePolicy(config, role);
  } catch (error) {
    effectiveError = error instanceof Error ? error.message : String(error);
  }
  const sandboxValues =
    role === "build"
      ? CODEX_SANDBOX_MODE_VALUES.filter((v) => v !== "read-only")
      : READ_ONLY_AGENT_ROLES.has(role)
        ? CODEX_SANDBOX_MODE_VALUES.filter((v) => v !== "danger-full-access")
        : [...CODEX_SANDBOX_MODE_VALUES];
  const approvalPolicyValues = READ_ONLY_AGENT_ROLES.has(role)
    ? CODEX_APPROVAL_POLICY_VALUES.filter((v) => v !== "never")
    : [...CODEX_APPROVAL_POLICY_VALUES];

  return (
    <div className="rounded-md border border-border bg-card p-3 space-y-3">
      <h4 className="text-sm font-semibold text-foreground">{AGENT_ROLE_LABELS[role]}</h4>
      <OverrideRow
        label={POLICY_LABELS.sandboxMode}
        value={override.sandboxMode}
        values={sandboxValues}
        disabled={disabled}
        onChange={(value) => onChange(role, "sandboxMode", value)}
      />
      <OverrideRow
        label={POLICY_LABELS.approvalPolicy}
        value={override.approvalPolicy}
        values={approvalPolicyValues}
        disabled={disabled}
        onChange={(value) => onChange(role, "approvalPolicy", value)}
      />
      <OverrideRow
        label={POLICY_LABELS.approvalsReviewer}
        value={override.approvalsReviewer}
        values={[...CODEX_APPROVALS_REVIEWER_VALUES]}
        disabled={disabled}
        onChange={(value) => onChange(role, "approvalsReviewer", value)}
      />
      <OverrideRow
        label={POLICY_LABELS.workspaceWriteNetworkAccess}
        value={override.workspaceWriteNetworkAccess}
        values={[false, true]}
        disabled={disabled}
        onChange={(value) => onChange(role, "workspaceWriteNetworkAccess", value)}
      />
      <div className="rounded-md border border-border bg-muted p-2 text-xs text-muted-foreground">
        {effective ? (
          <>
            Effective: sandbox {effective.sandboxMode}, approvals {effective.approvalPolicy},
            reviewer {effective.approvalsReviewer}, network{" "}
            {effective.workspaceWriteNetworkAccess ? "on" : "off"}.
            {effective.adjustmentReason ? ` ${effective.adjustmentReason}` : ""}
            {!effective.approvalsReviewerApplies
              ? " Reviewer is saved but has no effect while approval prompts are never."
              : ""}
          </>
        ) : (
          <span className="text-destructive">{effectiveError}</span>
        )}
      </div>
    </div>
  );
}

function OverrideRow<T extends string | boolean>({
  label,
  value,
  values,
  disabled,
  onChange,
}: {
  label: string;
  value: T | undefined;
  values: T[];
  disabled: boolean;
  onChange: (value: T | undefined) => void;
}): ReactElement {
  return (
    <PolicyRow label={label}>
      <SegmentedControlRoot className="flex-wrap" size="sm">
        <SegmentedControlItem
          active={value === undefined}
          disabled={disabled}
          onClick={() => onChange(undefined)}
        >
          inherit default
        </SegmentedControlItem>
        {values.map((option) => (
          <SegmentedControlItem
            key={String(option)}
            active={option === value}
            disabled={disabled}
            onClick={() => onChange(option)}
          >
            {typeof option === "boolean" ? (option ? "on" : "off") : VALUE_LABELS[String(option)]}
          </SegmentedControlItem>
        ))}
      </SegmentedControlRoot>
    </PolicyRow>
  );
}

function PolicyRow({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return (
    <div className="grid gap-2 md:grid-cols-[12rem_1fr] md:items-center">
      <Label className="text-xs text-foreground">{label}</Label>
      {children}
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
                    variant={selectedDefinition.kind === definition.kind ? "accent" : "ghost"}
                    className="w-full justify-between gap-3"
                    disabled={disabled}
                    onClick={() => setSelectedTab(definition.kind)}
                  >
                    <span className="truncate">{definition.label}</span>
                    <Badge variant="outline" className="shrink-0">
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

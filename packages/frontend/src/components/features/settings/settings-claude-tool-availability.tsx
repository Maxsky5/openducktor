import {
  resolveClaudePolicy,
  type AgentRole,
  type ClaudeRuntimeConfig,
  type ClaudeToolAvailability,
  type ClaudeToolCatalog,
} from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useId, useState, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/errors";
import { hostClient } from "@/lib/host-client";
import { useHostRuntimeStatusContext } from "@/state/app-state-contexts";
import {
  claudeToolCatalogQueryOptions,
  skippedClaudeToolCatalogQueryOptions,
} from "@/state/queries/claude-tool-catalog";
import { AGENT_ROLE_LABELS } from "@/types/agent-role-labels";
import { CLAUDE_POLICY_ROLES } from "./settings-claude-policy-fields";
import { ClaudeToolList } from "./settings-claude-tool-list";
import {
  RuntimePolicyCard,
  RuntimePolicyDefault,
  RuntimePolicyInfo,
  RuntimePolicyRoleOverrides,
} from "./settings-runtime-policy-layout";

export function ClaudeToolAvailabilitySettings({
  config,
  disabled,
  onChange,
}: SettingsProps): ReactElement {
  const status = useHostRuntimeStatusContext();
  const runtime = status.statusByKind.claude;
  const runtimeId = status.isCurrent && runtime?.state === "ready" ? runtime.runtimeId : null;
  const hostInstanceId = status.snapshot?.hostInstanceId;
  const query = useQuery(
    runtimeId && hostInstanceId
      ? claudeToolCatalogQueryOptions(hostInstanceId, runtimeId, (input) =>
          hostClient.agentRuntimeClaudeToolCatalog(input),
        )
      : skippedClaudeToolCatalogQueryOptions(),
  );
  let error: string | null = null;
  if (status.readError || status.streamError) error = status.readError ?? status.streamError;
  else if (!status.isLoading && !runtimeId)
    error = "Claude is not ready. Check Claude in Diagnostics, then reopen tool availability.";
  else if (query.isError) error = errorMessage(query.error);
  const catalog = !error && query.data?.runtimeId === runtimeId ? query.data : undefined;
  return (
    <ClaudeToolAvailabilityEditor
      config={config}
      disabled={disabled}
      onChange={onChange}
      catalog={catalog}
      error={error}
      loading={!error && query.isPending}
      onRetry={() => {
        if (runtimeId && hostInstanceId && !status.readError && !status.streamError)
          void query.refetch();
        else void status.refresh();
      }}
    />
  );
}

export function ClaudeToolAvailabilityEditor({
  config,
  disabled,
  onChange,
  catalog,
  error,
  loading,
  onRetry,
}: EditorProps): ReactElement {
  const id = useId();
  const [showRoles, setShowRoles] = useState(false);
  const hasOverride = CLAUDE_POLICY_ROLES.some(
    (role) => config.roleOverrides[role]?.toolAvailability !== undefined,
  );
  const defaults = resolveClaudePolicy(config).settings.toolAvailability;
  const setChoices = (role: AgentRole, next: ClaudeToolAvailability | undefined): void => {
    const policy = { ...config.roleOverrides[role] };
    if (next === undefined) delete policy.toolAvailability;
    else policy.toolAvailability = next;
    onChange({ ...config, roleOverrides: { ...config.roleOverrides, [role]: policy } });
  };
  const setRoles = (enabled: boolean): void => {
    setShowRoles(enabled);
    if (enabled || !hasOverride) return;

    const roleOverrides = { ...config.roleOverrides };
    for (const role of CLAUDE_POLICY_ROLES) {
      const policy = roleOverrides[role];
      if (policy?.toolAvailability === undefined) continue;
      const next = { ...policy };
      delete next.toolAvailability;
      roleOverrides[role] = next;
    }
    onChange({ ...config, roleOverrides });
  };
  return (
    <RuntimePolicyCard title="Tool availability">
      <RuntimePolicyInfo>
        <p className="text-sm">
          Turning a tool off removes it from Claude and its subagents. Turning it on removes
          OpenDucktor's exclusion. Native availability, permission rules, and role restrictions
          still apply.
        </p>
        <p className="text-sm">
          Save changes to apply them to new and forked sessions. Existing sessions keep their
          current tool settings.
        </p>
        <p className="text-sm">
          This catalog uses your home directory and Claude's default model. Provider, model,
          platform, and project policy can change which tools a session has. MCP tools use
          permission rules.
        </p>
        <p className="text-sm">
          Claude keeps Artifact tools off by default in SDK sessions. These switches do not turn on
          Claude's native Artifact feature.
        </p>
      </RuntimePolicyInfo>
      {error && (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-sm text-destructive-muted">
            {error}
          </p>
          <Button type="button" variant="outline" disabled={disabled || loading} onClick={onRetry}>
            Retry tool catalog
          </Button>
        </div>
      )}
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading Claude tools...
        </p>
      )}
      <RuntimePolicyDefault labelId={`${id}-default-label`} label="Default tool availability">
        <p className="text-sm text-muted-foreground">{toolSummary(defaults)}</p>
        <div className="min-w-0 @min-[34rem]:col-span-2">
          <ClaudeToolList
            scopeLabel="Default"
            choices={defaults}
            catalog={catalog}
            disabled={disabled}
            onChange={(toolAvailability) =>
              onChange({ ...config, defaults: { ...config.defaults, toolAvailability } })
            }
          />
        </div>
      </RuntimePolicyDefault>
      <RuntimePolicyRoleOverrides
        id={`${id}-roles`}
        label="Tool availability"
        enabled={showRoles || hasOverride}
        disabled={disabled}
        onEnabledChange={setRoles}
      >
        <div className="divide-y divide-border rounded-md border border-border">
          {CLAUDE_POLICY_ROLES.map((role) => {
            const roleId = `${id}-${role}`;
            const label = AGENT_ROLE_LABELS[role];
            const inherits = config.roleOverrides[role]?.toolAvailability === undefined;
            const choices = resolveClaudePolicy(config, role).settings.toolAvailability;
            return (
              <div
                key={role}
                className="grid gap-2 px-3 py-2.5 @min-[28rem]:grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)] @min-[28rem]:items-center"
              >
                <div className="flex flex-col gap-1">
                  <Label id={`${roleId}-label`} className="text-sm font-medium text-foreground">
                    {label}
                    <span className="sr-only"> tool availability</span>
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {inherits ? "Default" : "Override"}: {toolSummary(choices)}
                  </p>
                </div>
                <Combobox
                  value={inherits ? "inherit" : "explicit"}
                  options={[
                    {
                      value: "inherit",
                      label: "Inherited",
                      description: "Use the default tool choices for this role.",
                    },
                    {
                      value: "explicit",
                      label: "Use this list",
                      description: "Start from the defaults, then change this role's tool choices.",
                    },
                  ]}
                  disabled={disabled}
                  triggerAriaLabelledBy={`${roleId}-label`}
                  triggerClassName="h-10"
                  wrapOptionLabels
                  onValueChange={(next) => {
                    if (next === "inherit") setChoices(role, undefined);
                    else if (inherits) setChoices(role, { ...choices });
                  }}
                />
                {!inherits && (
                  <div className="min-w-0 @min-[28rem]:col-span-2">
                    <ClaudeToolList
                      scopeLabel={label}
                      choices={choices}
                      catalog={catalog}
                      disabled={disabled}
                      onChange={(next) => setChoices(role, next)}
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

type SettingsProps = {
  config: ClaudeRuntimeConfig;
  disabled: boolean;
  onChange: (config: ClaudeRuntimeConfig) => void;
};

type EditorProps = SettingsProps & {
  catalog: ClaudeToolCatalog | undefined;
  error: string | null;
  loading: boolean;
  onRetry: () => void;
};

function toolSummary(choices: ClaudeToolAvailability): string {
  const count = Object.values(choices).filter((enabled) => !enabled).length;
  if (count === 0) return "All tools enabled by preference";
  return `${count} ${count === 1 ? "tool" : "tools"} disabled`;
}

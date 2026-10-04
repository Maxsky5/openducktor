import type {
  OpenCodePermissionRule,
  OpenCodeRuntimeConfig,
  AgentRole,
} from "@openducktor/contracts";
import { useId, useState, type ReactElement } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ACTION_OPTIONS } from "./opencode-permission-options";
import { PermissionRole } from "./opencode-permission-role";
import { PermissionScope } from "./opencode-permission-scope";
import {
  RuntimePolicyCard,
  RuntimePolicyInfo,
  RuntimePolicyRoleOverrides,
} from "./settings-runtime-policy-layout";

const ROLES: AgentRole[] = ["spec", "planner", "build", "qa"];
const EMPTY_RULES: OpenCodePermissionRule[] = [];

type OpenCodePermissionsSettingsProps = {
  config: OpenCodeRuntimeConfig;
  disabled: boolean;
  onUpdate: (updater: (current: OpenCodeRuntimeConfig) => OpenCodeRuntimeConfig) => void;
};

export function OpenCodePermissionsSettings({
  config,
  disabled,
  onUpdate,
}: OpenCodePermissionsSettingsProps): ReactElement {
  const id = useId();
  const [showRoles, setShowRoles] = useState(false);
  const rolesVisible =
    showRoles || ROLES.some((role) => (config.roleOverrides[role]?.rules.length ?? 0) > 0);
  return (
    <RuntimePolicyCard title="OpenCode permissions">
      <PermissionInfoPanel disabled={disabled} />
      <p className="text-xs leading-relaxed text-muted-foreground">
        Saved changes apply only to new and forked sessions. Existing conversations and pending
        approvals keep their settings.
      </p>
      <PermissionScope
        label="Defaults"
        rules={config.defaults.rules}
        disabled={disabled}
        onChange={(rules) => onUpdate((current) => ({ ...current, defaults: { rules } }))}
      />
      <RuntimePolicyRoleOverrides
        id={`${id}-roles`}
        label="OpenCode permissions"
        enabled={rolesVisible}
        disabled={disabled}
        onEnabledChange={(enabled) => {
          setShowRoles(enabled);
          if (!enabled) onUpdate((current) => ({ ...current, roleOverrides: {} }));
        }}
      >
        <div className="divide-y divide-border rounded-md border border-border">
          {ROLES.map((role) => (
            <PermissionRole
              key={role}
              role={role}
              rules={config.roleOverrides[role]?.rules ?? EMPTY_RULES}
              disabled={disabled}
              onChange={(rules) =>
                onUpdate((current) => {
                  const roleOverrides = { ...current.roleOverrides };
                  if (rules.length === 0) delete roleOverrides[role];
                  else roleOverrides[role] = { rules };
                  return { ...current, roleOverrides };
                })
              }
            />
          ))}
        </div>
      </RuntimePolicyRoleOverrides>
    </RuntimePolicyCard>
  );
}

type PermissionInfoPanelProps = { disabled: boolean };

function PermissionInfoPanel({ disabled }: PermissionInfoPanelProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const helpId = useId();
  return (
    <RuntimePolicyInfo>
      <p className="text-sm leading-6">Rules run in order. The last matching rule wins.</p>
      <dl className="grid gap-1.5 border-t border-info-border/70 pt-2 text-sm">
        {ACTION_OPTIONS.map((option) => (
          <div key={option.value} className="grid gap-1 sm:grid-cols-[5rem_minmax(0,1fr)]">
            <dt className="font-semibold">{option.label}</dt>
            <dd className="leading-relaxed text-foreground/80">{option.description}</dd>
          </div>
        ))}
      </dl>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-fit px-0 text-xs"
        disabled={disabled}
        aria-expanded={expanded}
        aria-controls={helpId}
        onClick={() => setExpanded((value) => !value)}
      >
        Rule matching and priority
        {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
      </Button>
      {expanded ? (
        <div id={helpId} className="grid gap-2 text-sm leading-relaxed text-foreground/80">
          <p>
            Native OpenCode rules run first, then defaults, role rules, and mandatory OpenDucktor
            workflow policy. Explicit rules can override native Ask or Deny. Workflow policy has
            final priority.
          </p>
          <p>
            Use native * to match any text and ? to match one character. Path rules support ~, ~/
            and $HOME/. OpenCode matches commands and patterns. Rules do not install or enable
            tools.
          </p>
        </div>
      ) : null}
    </RuntimePolicyInfo>
  );
}

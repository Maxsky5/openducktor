import {
  ANTIGRAVITY_MODE_VALUES,
  type AntigravityMode,
  type AntigravityRuntimeConfig,
} from "@openducktor/contracts";
import { useWorkflowSettings } from "@openducktor/frontend-core/queries/workflow-settings";
import type { WorkflowRoleId as AgentRole } from "@openducktor/workflows";
import { type ReactElement, useState } from "react";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import {
  RuntimePolicyCard,
  RuntimePolicyDefault,
  RuntimePolicyInfo,
  RuntimePolicyRoleOverrides,
} from "./settings-runtime-policy-layout";

/** The names and descriptions of the modes. The first three are the Antigravity modes. */
const MODE_DISPLAY = {
  default: {
    label: "Default",
    description: "Ask before edits and commands, per your permission settings.",
  },
  "accept-edits": {
    label: "Accept edits",
    description: "Approve file edits in the workspace without asking.",
  },
  auto: {
    label: "Auto",
    description: "Approve edits and safe commands; ask before irreversible actions.",
  },
  "bypass-permissions": {
    label: "Bypass permissions",
    description: "Approve every action without asking, irreversible actions too.",
  },
} satisfies Record<AntigravityMode, { label: string; description: string }>;

const INHERIT_VALUE = "__inherit__";
const READ_ONLY_NOTE =
  "Read-only role. OpenDucktor refuses its file edits in every mode. The mode decides whether its commands and other tools run without asking.";

const modeOptions = ANTIGRAVITY_MODE_VALUES.map((mode) => ({
  value: mode,
  label: MODE_DISPLAY[mode].label,
  description: MODE_DISPLAY[mode].description,
}));

const toMode = (value: string): AntigravityMode => {
  const mode = ANTIGRAVITY_MODE_VALUES.find((candidate) => candidate === value);
  if (!mode) throw new Error(`Unknown Antigravity mode: ${value}`);
  return mode;
};

/** The session mode of Antigravity: a default for every role, and an override for a role. */
export function AntigravityPolicySettings({
  config,
  disabled,
  onUpdate,
}: {
  config: AntigravityRuntimeConfig;
  disabled: boolean;
  onUpdate: (updater: (config: AntigravityRuntimeConfig) => AntigravityRuntimeConfig) => void;
}): ReactElement {
  const [overridesOpen, setOverridesOpen] = useState(false);
  const hasOverrides = Object.values(config.roleOverrides).some(
    (override) => override?.mode !== undefined,
  );
  const overridesVisible = overridesOpen || hasOverrides;
  const updateOverride = (role: AgentRole, mode: AntigravityMode | undefined) =>
    onUpdate((current) => {
      const roleOverrides = { ...current.roleOverrides };
      if (mode === undefined) delete roleOverrides[role];
      else roleOverrides[role] = { mode };
      return { ...current, roleOverrides };
    });

  return (
    <RuntimePolicyCard title="Session mode">
      <RuntimePolicyInfo>
        <p className="max-w-3xl text-sm leading-6 text-pretty">
          Choose what Antigravity approves without asking. A new or reopened session uses the mode
          of its role. Your permission rules of Antigravity still apply in every mode.
        </p>
        <dl className="grid gap-1.5 border-info-border/70 border-t pt-2 text-sm">
          {modeOptions.map((option) => (
            <div
              key={option.value}
              className="grid gap-1 @min-[34rem]:grid-cols-[10rem_minmax(0,1fr)]"
            >
              <dt className="font-semibold">{option.label}</dt>
              <dd className="leading-relaxed text-foreground/80">{option.description}</dd>
            </div>
          ))}
        </dl>
      </RuntimePolicyInfo>

      <RuntimePolicyDefault labelId="antigravity-mode-default-label" label="Default mode">
        <Combobox
          value={config.defaults.mode}
          options={modeOptions}
          disabled={disabled}
          triggerAriaLabelledBy="antigravity-mode-default-label"
          searchPlaceholder="Search modes…"
          emptyText="No mode found."
          triggerClassName="h-10"
          wrapOptionLabels
          onValueChange={(value) =>
            onUpdate((current) => ({ ...current, defaults: { mode: toMode(value) } }))
          }
        />
      </RuntimePolicyDefault>

      <RuntimePolicyRoleOverrides
        id="antigravity-mode-role-overrides"
        label="Session mode"
        enabled={overridesVisible}
        disabled={disabled}
        onEnabledChange={(enabled) => {
          setOverridesOpen(enabled);
          if (!enabled) onUpdate((current) => ({ ...current, roleOverrides: {} }));
        }}
      >
        <AntigravityRoleOverrides
          config={config}
          disabled={disabled}
          onOverrideChange={updateOverride}
        />
      </RuntimePolicyRoleOverrides>
    </RuntimePolicyCard>
  );
}

function AntigravityRoleOverrides({
  config,
  disabled,
  onOverrideChange,
}: {
  config: AntigravityRuntimeConfig;
  disabled: boolean;
  onOverrideChange: (role: AgentRole, mode: AntigravityMode | undefined) => void;
}): ReactElement {
  const workflows = useWorkflowSettings();
  if (!workflows.data || workflows.error)
    return (
      <p role={workflows.error ? "alert" : "status"}>
        {workflows.error?.message ?? "Loading workflow roles..."}
      </p>
    );
  return (
    <div className="divide-y divide-border rounded-md border border-border">
      {workflows.data.roles.map(({ role, label, definition }) => {
        const labelId = `antigravity-mode-${role}-override-label`;
        const readOnly = definition.workspaceAccess !== "write";
        const override = config.roleOverrides[role]?.mode;
        return (
          <div
            key={role}
            className="grid gap-2 px-3 py-2.5 @min-[28rem]:grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)] @min-[28rem]:items-center"
          >
            <Label id={labelId} className="text-sm font-medium text-foreground">
              {label}
            </Label>
            <div className="flex flex-col gap-1">
              <Combobox
                value={override ?? INHERIT_VALUE}
                options={[
                  {
                    value: INHERIT_VALUE,
                    label: "Inherited",
                    description: "Use the default mode for this role.",
                  },
                  ...modeOptions,
                ]}
                disabled={disabled}
                triggerAriaLabelledBy={labelId}
                searchPlaceholder="Search modes…"
                emptyText="No mode found."
                triggerClassName="h-10"
                wrapOptionLabels
                onValueChange={(value) =>
                  onOverrideChange(role, value === INHERIT_VALUE ? undefined : toMode(value))
                }
              />
              {readOnly ? <p className="text-xs text-muted-foreground">{READ_ONLY_NOTE}</p> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

import { useWorkflowSettings } from "@openducktor/frontend-core/queries/workflow-settings";
import type { AutopilotSettings } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import {
  AUTOPILOT_DISABLED_VALUE,
  getAutopilotRule,
  getAutopilotSelectedValue,
  setAutopilotRuleAction,
} from "@/features/autopilot/autopilot-catalog";
import { SettingsSwitchRow } from "./settings-switch-row";

type SettingsAutopilotSectionProps = {
  autopilot: AutopilotSettings;
  disabled: boolean;
  loadError: string | null;
  onUpdateAutopilot: (updater: (current: AutopilotSettings) => AutopilotSettings) => void;
};

export function SettingsAutopilotSection({
  autopilot,
  disabled,
  loadError,
  onUpdateAutopilot,
}: SettingsAutopilotSectionProps): ReactElement {
  const workflows = useWorkflowSettings();
  if (!workflows.data || workflows.error)
    return (
      <p role={workflows.error ? "alert" : "status"}>
        {workflows.error?.message ?? "Loading workflow automations..."}
      </p>
    );
  return (
    <div className="grid gap-4 p-4">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Autopilot</h3>
        <p className="text-xs text-muted-foreground">
          Autopilot runs on the OpenDucktor host for every open workspace while the host runs. It
          works whichever workspace is selected, also when no browser is connected.
        </p>
      </div>

      {loadError ? (
        <p role="alert" className="text-xs text-destructive">
          The saved Autopilot rules could not load: {loadError} Close and reopen settings to try
          again.
        </p>
      ) : null}

      <SettingsSwitchRow
        title="Always start QA reviews in a fresh session"
        description="This applies only to QA reviews started by Autopilot. Each review gets a new session."
        checked={autopilot.alwaysStartQaReviewsFresh}
        disabled={disabled}
        ariaLabel="Always start QA reviews in a fresh session"
        onCheckedChange={(checked) =>
          onUpdateAutopilot((current) => ({ ...current, alwaysStartQaReviewsFresh: checked }))
        }
      />

      <div className="grid gap-3 rounded-md border border-border bg-card p-4">
        {workflows.data.workflows.flatMap((taskWorkflow) =>
          taskWorkflow.definition.signals.map((eventDefinition) => {
            const rule = getAutopilotRule(autopilot, taskWorkflow.reference.id, eventDefinition.id);
            const selectedValue = getAutopilotSelectedValue(rule);
            const labelId = `autopilot-${taskWorkflow.reference.id}-${taskWorkflow.reference.revision}-${eventDefinition.id}-label`;
            const automationById = new Map(
              taskWorkflow.definition.automations.map((automation) => [automation.id, automation]),
            );
            const options = [
              {
                value: AUTOPILOT_DISABLED_VALUE,
                label: "Disabled",
                description: "Do not trigger an automatic workflow action for this event.",
              },
              ...eventDefinition.automations.map((actionId) => {
                const automation = automationById.get(actionId);
                if (!automation)
                  throw new Error(`Automation "${actionId}" is missing. Reload the workflow.`);
                return {
                  value: `action:${actionId}`,
                  label: automation.label,
                  description: automation.description,
                };
              }),
            ];

            return (
              <div
                key={labelId}
                className="grid gap-3 rounded-md border border-border/70 bg-muted/40 p-3 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start"
              >
                <div className="space-y-1">
                  <Label id={labelId} className="text-sm font-medium text-foreground">
                    {eventDefinition.label}
                  </Label>
                  <p className="text-xs text-muted-foreground">{eventDefinition.description}</p>
                </div>
                <div className="space-y-1">
                  <Combobox
                    value={selectedValue}
                    options={options}
                    disabled={disabled}
                    placeholder="Select an action"
                    searchPlaceholder="Search actions..."
                    triggerClassName="justify-between"
                    triggerAriaLabelledBy={labelId}
                    onValueChange={(value) => {
                      if (!options.some((option) => option.value === value)) {
                        return;
                      }
                      onUpdateAutopilot((current) =>
                        setAutopilotRuleAction(
                          current,
                          taskWorkflow.reference.id,
                          eventDefinition.id,
                          value,
                        ),
                      );
                    }}
                  />
                </div>
              </div>
            );
          }),
        )}
      </div>

      <div className="rounded-md border border-border bg-muted/60 p-3 text-xs text-muted-foreground">
        Autopilot reacts only to task changes committed while the host runs. It does not start work
        for changes from before the host started. Work that has not started when the host stops is
        lost.
      </div>
    </div>
  );
}

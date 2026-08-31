import type { AutopilotSettings } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AUTOPILOT_ACTION_DEFINITIONS,
  AUTOPILOT_DISABLED_VALUE,
  AUTOPILOT_EVENT_DEFINITIONS,
  type AutopilotSelectValue,
  getAutopilotRule,
  getAutopilotSelectedValue,
  setAutopilotRuleAction,
} from "@/features/autopilot/autopilot-catalog";

type SettingsAutopilotSectionProps = {
  autopilot: AutopilotSettings;
  disabled: boolean;
  onUpdateAutopilot: (updater: (current: AutopilotSettings) => AutopilotSettings) => void;
};

const isAutopilotSelectValue = (value: string): value is AutopilotSelectValue =>
  value === AUTOPILOT_DISABLED_VALUE || Object.hasOwn(AUTOPILOT_ACTION_DEFINITIONS, value);

export function SettingsAutopilotSection({
  autopilot,
  disabled,
  onUpdateAutopilot,
}: SettingsAutopilotSectionProps): ReactElement {
  return (
    <div className="grid gap-4 p-4">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Autopilot</h3>
        <p className="text-xs text-muted-foreground">
          Automatically start workflow actions when task transitions are observed while the app is
          running.
        </p>
      </div>

      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              Always start QA reviews in a fresh session
            </p>
            <p className="text-xs text-muted-foreground">
              This applies only to QA reviews started by Autopilot. Each review gets a new session.
            </p>
          </div>
          <Switch
            checked={autopilot.alwaysStartQaReviewsFresh}
            onCheckedChange={(checked) =>
              onUpdateAutopilot((current) => ({
                ...current,
                alwaysStartQaReviewsFresh: checked,
              }))
            }
            disabled={disabled}
            aria-label="Always start QA reviews in a fresh session"
          />
        </div>
      </div>

      <div className="grid gap-3 rounded-md border border-border bg-card p-4">
        {AUTOPILOT_EVENT_DEFINITIONS.map((eventDefinition) => {
          const rule = getAutopilotRule(autopilot, eventDefinition.id);
          const selectedValue = getAutopilotSelectedValue(rule);
          const options = [
            {
              value: AUTOPILOT_DISABLED_VALUE,
              label: "Disabled",
              description: "Do not trigger an automatic workflow action for this event.",
            },
            ...eventDefinition.availableActionIds.map((actionId) => ({
              value: actionId,
              label: AUTOPILOT_ACTION_DEFINITIONS[actionId].label,
              description: AUTOPILOT_ACTION_DEFINITIONS[actionId].description,
            })),
          ];

          return (
            <div
              key={eventDefinition.id}
              className="grid gap-3 rounded-md border border-border/70 bg-muted/40 p-3 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start"
            >
              <div className="space-y-1">
                <Label className="text-sm font-medium text-foreground">
                  {eventDefinition.label}
                </Label>
                <p className="text-xs text-muted-foreground">{eventDefinition.description}</p>
              </div>
              <Combobox
                value={selectedValue}
                options={options}
                disabled={disabled}
                placeholder="Select an action"
                searchPlaceholder="Search actions..."
                triggerClassName="justify-between"
                onValueChange={(value) => {
                  if (!isAutopilotSelectValue(value)) {
                    return;
                  }
                  onUpdateAutopilot((current) =>
                    setAutopilotRuleAction(current, eventDefinition.id, value),
                  );
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="rounded-md border border-border bg-muted/60 p-3 text-xs text-muted-foreground">
        Autopilot only reacts to transitions observed during this app session and never replays
        missed events from while the app was closed.
      </div>
    </div>
  );
}

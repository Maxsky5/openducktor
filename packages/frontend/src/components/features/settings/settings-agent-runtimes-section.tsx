import type { AgentRuntimes, RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type AgentRuntimesSectionProps = {
  agentRuntimes: AgentRuntimes;
  runtimeDefinitions: RuntimeDescriptor[];
  disabled: boolean;
  onUpdateAgentRuntimes: (updater: (current: AgentRuntimes) => AgentRuntimes) => void;
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

export function AgentRuntimesSection({
  agentRuntimes,
  runtimeDefinitions,
  disabled,
  onUpdateAgentRuntimes,
}: AgentRuntimesSectionProps): ReactElement {
  const sortedRuntimeDefinitions = sortRuntimeDefinitionsForSettings(runtimeDefinitions);

  return (
    <div className="grid gap-4 p-4">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Agent Runtimes</h3>
        <p className="text-xs text-muted-foreground">
          Disabled runtimes are not started automatically and must be enabled before new agent
          sessions can use them.
        </p>
      </div>

      <div className="grid gap-3">
        {sortedRuntimeDefinitions.map((definition) => {
          const runtimeKind = definition.kind as RuntimeKind;
          const enabled = agentRuntimes[runtimeKind]?.enabled === true;
          return (
            <div
              key={definition.kind}
              className="grid gap-3 rounded-md border border-border bg-card p-3 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div className="min-w-0 space-y-1">
                <Label htmlFor={`agent-runtime-${definition.kind}`} className="text-sm">
                  {definition.label}
                </Label>
                <p className="text-xs text-muted-foreground">{definition.description}</p>
                <p className="text-xs text-muted-foreground">
                  Supports: {definition.capabilities.workflow.supportedScopes.join(", ")} scopes.
                </p>
              </div>
              <div className="flex items-center gap-2 justify-self-start sm:justify-self-end">
                <span className="text-xs text-muted-foreground">
                  {enabled ? "Enabled" : "Disabled"}
                </span>
                <Switch
                  id={`agent-runtime-${definition.kind}`}
                  checked={enabled}
                  disabled={disabled}
                  onCheckedChange={(nextEnabled) =>
                    onUpdateAgentRuntimes((current) => ({
                      ...current,
                      [runtimeKind]: {
                        ...(current[runtimeKind] ?? {}),
                        enabled: nextEnabled,
                      },
                    }))
                  }
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

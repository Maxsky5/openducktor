import { type SystemSettings, systemOpenInToolIdSchema } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { type ReactElement, useId } from "react";
import { OpenInToolIcon } from "@/components/features/agents/agent-studio-git-panel/open-in-tool-metadata";
import {
  getDefaultOpenInTool,
  getOpenInToolLabel,
} from "@/components/features/agents/agent-studio-git-panel/open-in-tool-metadata-model";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/errors";
import { openInToolsQueryOptions } from "@/state/queries/system";

type SettingsOpenInToolProps = {
  system: SystemSettings;
  disabled: boolean;
  onUpdateSystem: (updater: (current: SystemSettings) => SystemSettings) => void;
};

export function SettingsOpenInTool({
  system,
  disabled,
  onUpdateSystem,
}: SettingsOpenInToolProps): ReactElement {
  const toolsQuery = useQuery(openInToolsQueryOptions());
  const labelId = useId();
  const descriptionId = useId();
  const preferredToolId = system.preferredOpenInToolId;
  const tools = toolsQuery.data ?? [];
  const defaultTool = getDefaultOpenInTool(tools, preferredToolId);
  const options = tools.map((tool) => ({
    value: tool.toolId,
    label: getOpenInToolLabel(tool.toolId),
    icon: <OpenInToolIcon tool={tool} />,
  }));
  const unavailablePreference =
    preferredToolId !== undefined &&
    toolsQuery.isSuccess &&
    !toolsQuery.data.some(({ toolId }) => toolId === preferredToolId);
  return (
    <div className="grid gap-3 rounded-md border border-border bg-card p-4 md:grid-cols-[minmax(0,1fr)_16rem] md:items-start">
      <div className="grid gap-2">
        <Label id={labelId}>Preferred Open In tool</Label>
        <p id={descriptionId} className="text-xs text-muted-foreground">
          Choose which app opens repositories and worktrees.
        </p>
        {unavailablePreference ? (
          <p className="text-xs text-muted-foreground">
            {getOpenInToolLabel(preferredToolId)} is unavailable.
            {defaultTool ? ` Open In will use ${getOpenInToolLabel(defaultTool.toolId)}.` : null}
          </p>
        ) : null}
      </div>
      <div className="grid gap-2">
        <Combobox
          value={defaultTool?.toolId ?? ""}
          options={options}
          placeholder="No supported apps found"
          disabled={disabled || toolsQuery.isPending || toolsQuery.isError || tools.length === 0}
          triggerAriaLabelledBy={labelId}
          triggerAriaDescribedBy={descriptionId}
          searchPlaceholder="Search tools..."
          onValueChange={(value) =>
            onUpdateSystem(() => ({
              preferredOpenInToolId: systemOpenInToolIdSchema.parse(value),
            }))
          }
        />
        {preferredToolId ? (
          <Button variant="outline" disabled={disabled} onClick={() => onUpdateSystem(() => ({}))}>
            Clear preference
          </Button>
        ) : null}
        {toolsQuery.isPending ? (
          <p className="text-xs text-muted-foreground">Looking for supported apps…</p>
        ) : null}
        {toolsQuery.isError ? (
          <div role="alert" className="grid gap-2 text-sm text-destructive">
            <p>Failed to load supported apps: {errorMessage(toolsQuery.error)}</p>
            <Button
              variant="outline"
              disabled={disabled || toolsQuery.isFetching}
              onClick={() => void toolsQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

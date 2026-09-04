import { type SystemSettings, systemOpenInToolIdSchema } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { type ReactElement, useId } from "react";
import { getOpenInToolLabel } from "@/components/features/agents/agent-studio-git-panel/open-in-tool-metadata-model";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/errors";
import { openInToolsQueryOptions } from "@/state/queries/system";

type SettingsSystemSectionProps = {
  system: SystemSettings;
  disabled: boolean;
  onUpdateSystem: (updater: (current: SystemSettings) => SystemSettings) => void;
};

export function SettingsSystemSection({
  system,
  disabled,
  onUpdateSystem,
}: SettingsSystemSectionProps): ReactElement {
  const toolsQuery = useQuery(openInToolsQueryOptions());
  const labelId = useId();
  const descriptionId = useId();
  const preferredToolId = system.preferredOpenInToolId;
  const options = [
    { value: "default", label: "First available tool" },
    ...(toolsQuery.data ?? []).map(({ toolId }) => ({
      value: toolId,
      label: getOpenInToolLabel(toolId),
    })),
  ];
  const unavailablePreference =
    preferredToolId !== undefined &&
    toolsQuery.isSuccess &&
    !toolsQuery.data.some(({ toolId }) => toolId === preferredToolId);
  const selectedLabel = preferredToolId
    ? getOpenInToolLabel(preferredToolId)
    : "First available tool";

  return (
    <div className="grid gap-4 p-4">
      <div className="grid gap-2">
        <h3 className="text-sm font-semibold text-foreground">System</h3>
        <p className="text-xs text-muted-foreground">
          Choose the app used by Open In across OpenDucktor.
        </p>
      </div>
      <div className="grid gap-3 rounded-md border border-border bg-card p-4 md:grid-cols-[minmax(0,1fr)_16rem] md:items-start">
        <div className="grid gap-2">
          <Label id={labelId}>Preferred Open In tool</Label>
          <p id={descriptionId} className="text-xs text-muted-foreground">
            The tool selected by default in Agent Studio.
          </p>
          {unavailablePreference ? (
            <p className="text-xs text-muted-foreground">
              {selectedLabel} is unavailable. Open In will use the first available tool.
            </p>
          ) : null}
        </div>
        <div className="grid gap-2">
          <Combobox
            value={preferredToolId ?? "default"}
            options={options}
            placeholder={selectedLabel}
            disabled={disabled || toolsQuery.isPending || toolsQuery.isError}
            triggerAriaLabelledBy={labelId}
            triggerAriaDescribedBy={descriptionId}
            searchPlaceholder="Search tools..."
            onValueChange={(value) =>
              onUpdateSystem(() =>
                value === "default"
                  ? {}
                  : { preferredOpenInToolId: systemOpenInToolIdSchema.parse(value) },
              )
            }
          />
          {preferredToolId ? (
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => onUpdateSystem(() => ({}))}
            >
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
    </div>
  );
}

import type { ReactElement } from "react";
import { SettingsModal } from "@/components/features/settings/settings-modal";
import { buildDevServerSettingsOpenTarget } from "./agent-studio-right-panel-settings";

export function AgentStudioDevServerSettingsAction({
  repositoryPath,
}: {
  repositoryPath: string | null;
}): ReactElement {
  return (
    <SettingsModal
      triggerIconOnly
      triggerSize="icon"
      triggerClassName="shrink-0"
      triggerLabel="Configure dev server commands"
      openTarget={buildDevServerSettingsOpenTarget(repositoryPath)}
    />
  );
}

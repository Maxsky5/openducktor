import type { ReactElement } from "react";
import { SettingsModal } from "@/components/features/settings/settings-modal";

type AgentStudioDevServerSettingsActionProps = {
  repositoryPath: string | null;
};

export function AgentStudioDevServerSettingsAction({
  repositoryPath,
}: AgentStudioDevServerSettingsActionProps): ReactElement {
  return (
    <SettingsModal
      triggerIconOnly
      triggerSize="sm"
      triggerClassName="size-8 shrink-0 p-0"
      triggerLabel="Configure dev server commands"
      deepLink={{ kind: "repository-dev-servers", repositoryPath }}
    />
  );
}

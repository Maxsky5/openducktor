import type { ReactElement } from "react";
import { SettingsModal } from "@/components/features/settings/settings-modal";

export function AgentStudioDevServerSettingsAction({
  repositoryPath,
}: {
  repositoryPath: string | null;
}): ReactElement {
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

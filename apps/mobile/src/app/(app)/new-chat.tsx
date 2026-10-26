import { useLocalSearchParams } from "expo-router";
import type { ReactElement } from "react";
import { useMobileWorkspaces } from "@/composition/workspace-selection";
import { NewChatSheet } from "@/features/new-chat/new-chat-sheet";
import { SheetScreen } from "@/navigation/sheet-screen";
import { Screen } from "@/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";

export default function NewChatRoute(): ReactElement {
  const { workspaceId } = useLocalSearchParams();
  const { workspaces, isLoading, error, refreshWorkspaces } = useMobileWorkspaces();
  const id = Array.isArray(workspaceId) ? workspaceId[0] : workspaceId;
  const workspace = workspaces.find((entry) => entry.workspaceId === id) ?? null;
  if (workspace) return <NewChatSheet key={workspace.workspaceId} workspace={workspace} />;
  let content: ReactElement;
  if (isLoading) {
    content = <LoadingState label="Loading workspaces" />;
  } else if (error) {
    content = (
      <ErrorState title="Workspaces did not load" message={error} onRetry={refreshWorkspaces} />
    );
  } else {
    content = (
      <EmptyState
        icon="message-square-off"
        title="Workspace Not Open"
        message="Open the workspace on the host, then create the chat from Sessions."
      />
    );
  }
  return (
    <SheetScreen title="New Chat">
      <Screen background="sheet">{content}</Screen>
    </SheetScreen>
  );
}

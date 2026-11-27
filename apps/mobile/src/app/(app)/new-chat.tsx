import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { type ReactElement, useEffect } from "react";
import { useMobileWorkspaces } from "@/composition/workspace-selection";
import {
  NewChatDraftScreen,
  StartupAttemptRecoveryScreen,
} from "@/features/new-chat/new-chat-screen";
import { routeParam } from "@/navigation/route-params";
import { Screen } from "@/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";

export default function NewChatRoute(): ReactElement {
  const params = useLocalSearchParams();
  const router = useRouter();
  const { drafts } = useClientConnection();
  const { workspaces, isLoading, error, refreshWorkspaces } = useMobileWorkspaces();
  const workspaceId = routeParam(params["workspaceId"]);
  const routeDraftId = routeParam(params["draftId"]);
  const startupAttemptId = routeParam(params["startupAttemptId"]);
  const workspace = workspaces.find((entry) => entry.workspaceId === workspaceId) ?? null;

  useEffect(() => {
    if (!workspace || routeDraftId || startupAttemptId) return;
    const created = drafts.newWorkspaceSessions.ensureDraftForNewSession(
      workspace.workspaceId,
      null,
    );
    router.setParams({ workspaceId: workspace.workspaceId, draftId: created.id });
  }, [drafts.newWorkspaceSessions, routeDraftId, router, startupAttemptId, workspace]);

  if (workspace && startupAttemptId && !routeDraftId) {
    return (
      <StartupAttemptRecoveryScreen
        key={`startup:${startupAttemptId}`}
        workspace={workspace}
        startupAttemptId={startupAttemptId}
      />
    );
  }

  if (workspace && routeDraftId) {
    return <NewChatDraftScreen key={routeDraftId} workspace={workspace} draftId={routeDraftId} />;
  }

  let content: ReactElement;
  if (isLoading || (workspace && !routeDraftId && !startupAttemptId)) {
    content = <LoadingState label="Preparing session" />;
  } else if (error) {
    content = (
      <ErrorState title="Workspaces did not load" message={error} onRetry={refreshWorkspaces} />
    );
  } else {
    content = (
      <EmptyState
        icon="message-square-off"
        title="Workspace not open"
        message="Open the workspace on the host, then create the session from the Sessions tab."
      />
    );
  }
  return (
    <Screen>
      <Stack.Screen options={{ title: "New Session" }} />
      {content}
    </Screen>
  );
}

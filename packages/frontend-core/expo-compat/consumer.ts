// This file uses the frontend core as a React Native or Expo app does. It compiles without DOM,
// Node, or Bun types, so a public entry point that needs them breaks this compile.
import {
  type ClientFeedback,
  ClientConnectionProvider,
  createClientConnection,
  createClientQueryClient,
  createMemoryClientStorage,
  type DeviceFileReference,
  type NotificationBridge,
  useHostClient,
} from "@openducktor/frontend-core";
import { WorkspaceScopeContext } from "../src/app-state/app-state-contexts";
import { WorkspaceActivityProvider } from "../src/app-state/providers/workspace-activity-provider";
import { useInlineCommentDraftStore } from "../src/drafts/use-inline-comment-draft-store";
import { createNotificationRuntime } from "../src/notifications/notification-runtime";
import { repoTaskDataQueryOptions } from "../src/queries/tasks";
import { createRemoteHostConnection } from "../src/recovery/remote-host-connection";
import { useAgentSessionsContext } from "../src/sessions/session-contexts";
import type { WorkspaceRecord } from "@openducktor/contracts";
import type { RemoteTransport } from "@openducktor/host-client/remote";
import { useQuery } from "@tanstack/react-query";
import { createElement, type ReactElement } from "react";

/** A native picker returns files with a device URI that only the app can read. */
type NativePickedFile = DeviceFileReference & { readonly uri: string };

declare const nativeTransport: RemoteTransport;
declare const nativeNotifications: NotificationBridge;
declare const readNativeFileBase64: (file: NativePickedFile) => Promise<string>;

const nativeFeedback: ClientFeedback = {
  show: (kind, message) => console.info(kind, message),
  dismiss: () => {},
};

export const connectToHost = (endpoint: string) => {
  const queryClient = createClientQueryClient();
  const host = createRemoteHostConnection({
    endpoint,
    version: "mobile-release",
    transport: nativeTransport,
    queryClient,
  });
  return createClientConnection({
    host,
    queryClient,
    storage: createMemoryClientStorage(),
    feedback: nativeFeedback,
    stageAttachment: async (file) => {
      // SAFETY: This app stages only files that its own native picker returned.
      const picked = file as NativePickedFile;
      const staged = await host.client.workspaceStageLocalAttachment({
        name: picked.name,
        base64Data: await readNativeFileBase64(picked),
      });
      return staged.path;
    },
    releaseHost: () => host.remote.disconnect(),
  });
};

export const startNotifications = (connection: ReturnType<typeof connectToHost>) =>
  createNotificationRuntime({
    bridge: nativeNotifications,
    publishAction: connection.host.client.notificationPublishAction,
    subscribeStream: connection.host.subscribeNotificationStream,
    navigate: async () => {},
    onFailure: (failure) => nativeFeedback.show("error", failure.message),
    onCoordinationRecovered: () => {},
    inApp: { deliver: async () => {}, dismiss: () => {} },
    sound: { play: async () => {} },
  });

export function TaskCount({ repoPath }: { repoPath: string }): ReactElement | null {
  const host = useHostClient();
  const tasks = useQuery(repoTaskDataQueryOptions(repoPath));
  const sessions = useAgentSessionsContext();
  const draftCount = useInlineCommentDraftStore((store) => store.getDraftCount("owner"));
  void host;
  void sessions;
  void draftCount;
  return tasks.data ? createElement("Text", null, String(tasks.data.tasks.length)) : null;
}

/** The app supplies only the open workspaces and the selected one to the shared providers. */
export const renderApp = (
  connection: ReturnType<typeof connectToHost>,
  workspaces: WorkspaceRecord[],
): ReactElement =>
  createElement(
    ClientConnectionProvider,
    { connection },
    createElement(
      WorkspaceScopeContext.Provider,
      { value: { workspaces, activeWorkspace: workspaces[0] ?? null } },
      createElement(
        WorkspaceActivityProvider,
        null,
        createElement(TaskCount, { repoPath: "/repo" }),
      ),
    ),
  );

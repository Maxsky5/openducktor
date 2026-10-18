import {
  type ClientConnection,
  createClientConnection,
} from "@openducktor/frontend-core/connection/client-connection";
import { createMemoryClientStorage } from "@openducktor/frontend-core/platform/client-storage";
import type { QueryClient } from "@tanstack/react-query";
import { createBrowserAttachmentStager } from "./local-attachment-files";
import type { ShellBridge } from "./shell-bridge";
import { sonnerFeedback } from "./sonner-feedback";

/**
 * Creates the client connection of the selected host. The connection owns the host reads and drafts
 * of this page. Its disposal closes the shell transport. It does not stop work on the host.
 *
 * A remote host keeps its drafts, layouts, and recent items in page memory, so they cannot replace
 * the local-host data of this device. The reload clears them, so disposal does not save them.
 */
export const createShellConnection = (
  bridge: ShellBridge,
  queryClient: QueryClient,
  hostKind: "local" | "remote",
): ClientConnection =>
  createClientConnection({
    host: bridge,
    queryClient,
    storage: hostKind === "remote" ? createMemoryClientStorage() : localStorage,
    saveDraftsOnDispose: hostKind === "local",
    feedback: sonnerFeedback,
    stageAttachment: createBrowserAttachmentStager(bridge.client),
    ...(bridge.dispose && { releaseHost: bridge.dispose }),
  });

/**
 * Unmounts the app first, so its subscriptions stop and its composers save their drafts before the
 * connection clears its state.
 */
export const releaseShellConnection = async (
  connection: ClientConnection,
  unmountApp: () => void,
): Promise<void> => {
  unmountApp();
  await connection.dispose();
};

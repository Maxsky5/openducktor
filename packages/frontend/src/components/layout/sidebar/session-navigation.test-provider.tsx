import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import type { ClientConnection } from "@openducktor/frontend-core/connection/client-connection";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { useState, type ReactNode } from "react";
import { HostRuntimeStatusContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { runtimeQueryKeys } from "@openducktor/frontend-core/queries/runtime";
import { WorkspaceActivityContext } from "@/state/workspace-activity/workspace-activity-context";
import {
  createHostRuntimeStatusContextValue,
  createWorkspaceActivityObserverStub,
} from "@/test-utils/shared-test-fixtures";
import { VisibleSessionTargetProvider } from "@/features/session-navigation/visible-session-target";
import { SessionReadStateProvider } from "@/features/session-navigation/session-read-state";
import { SessionMenuProvider } from "./session-menu-provider";
import { type SessionSelection, SessionSelectionContext } from "./session-navigation-selection";

const observer = createWorkspaceActivityObserverStub();
const runtimeStatus = createHostRuntimeStatusContextValue();

const NO_SELECTION: SessionSelection = { entryKey: null, visibleKey: null };

/**
 * Pass `connection` to supply host fakes, for example from `createTestClientConnection({ client })`.
 * Pass `selection` for the session list rows, as `SessionSelectionScope` does in the sidebar.
 */
export function SessionNavigationTestProvider({
  children,
  connection,
  selection = NO_SELECTION,
}: {
  children: ReactNode;
  connection?: ClientConnection;
  selection?: SessionSelection;
}) {
  const [testConnection] = useState(() => {
    const next = connection ?? createTestClientConnection();
    next.queryClient.setQueryData(
      runtimeQueryKeys.definitions(),
      Object.values(RUNTIME_DESCRIPTORS_BY_KIND),
    );
    return next;
  });
  return (
    <ClientConnectionProvider connection={testConnection}>
      <HostRuntimeStatusContext value={runtimeStatus}>
        <WorkspaceActivityContext value={observer}>
          <VisibleSessionTargetProvider>
            <SessionReadStateProvider>
              <SessionMenuProvider>
                <SessionSelectionContext value={selection}>{children}</SessionSelectionContext>
              </SessionMenuProvider>
            </SessionReadStateProvider>
          </VisibleSessionTargetProvider>
        </WorkspaceActivityContext>
      </HostRuntimeStatusContext>
    </ClientConnectionProvider>
  );
}

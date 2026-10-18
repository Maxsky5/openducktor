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

const observer = createWorkspaceActivityObserverStub();
const runtimeStatus = createHostRuntimeStatusContextValue();

/** Pass `connection` to supply host fakes, for example from `createTestClientConnection({ client })`. */
export function SessionNavigationTestProvider({
  children,
  connection,
}: {
  children: ReactNode;
  connection?: ClientConnection;
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
              <SessionMenuProvider>{children}</SessionMenuProvider>
            </SessionReadStateProvider>
          </VisibleSessionTargetProvider>
        </WorkspaceActivityContext>
      </HostRuntimeStatusContext>
    </ClientConnectionProvider>
  );
}

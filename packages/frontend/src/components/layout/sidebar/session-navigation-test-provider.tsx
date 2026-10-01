import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { runtimeQueryKeys } from "@/state/queries/runtime";
import { WorkspaceActivityContext } from "@/state/workspace-activity/workspace-activity-context";
import { createWorkspaceActivityObserverStub } from "@/test-utils/shared-test-fixtures";
import { VisibleSessionTargetProvider } from "@/features/session-navigation/visible-session-target";
import { SessionReadStateProvider } from "@/features/session-navigation/session-read-state";
import { SessionMenuProvider } from "./session-menu-provider";

const observer = createWorkspaceActivityObserverStub();

export function SessionNavigationTestProvider({
  children,
  client,
}: {
  children: ReactNode;
  client?: QueryClient;
}) {
  const [queryClient] = useState(() => {
    const query =
      client ?? new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    query.setQueryData(runtimeQueryKeys.definitions(), Object.values(RUNTIME_DESCRIPTORS_BY_KIND));
    return query;
  });
  return (
    <QueryClientProvider client={queryClient}>
      <WorkspaceActivityContext value={observer}>
        <VisibleSessionTargetProvider>
          <SessionReadStateProvider>
            <SessionMenuProvider>{children}</SessionMenuProvider>
          </SessionReadStateProvider>
        </VisibleSessionTargetProvider>
      </WorkspaceActivityContext>
    </QueryClientProvider>
  );
}

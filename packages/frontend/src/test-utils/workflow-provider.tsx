import { useState, type PropsWithChildren } from "react";
import { ActiveWorkspaceContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import {
  createTaskCardFixture,
  toWireTaskCard,
} from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import {
  builtinCompiledCatalogFixture,
  builtinWorkspaceWorkflowsFixture,
} from "@openducktor/frontend-core/test-support/workflow-fixtures";
import { workflowQueryKeys } from "@openducktor/frontend-core/queries/workflows";
import { taskQueryKeys } from "@openducktor/frontend-core/queries/tasks";

/** A host workflow for component tests that do not exercise metadata loading. */
export function WorkflowTestProvider({ children }: PropsWithChildren) {
  const [connection] = useState(() => {
    const task = createTaskCardFixture({ id: "task-1" });
    const connection = createTestClientConnection({
      client: { tasksListAll: async () => [toWireTaskCard(task)] },
    });
    connection.queryClient.setQueryData(workflowQueryKeys.catalog, builtinCompiledCatalogFixture);
    connection.queryClient.setQueryData(
      workflowQueryKeys.workspace({ workspaceId: "workspace-1", repoPath: "/repo" }),
      builtinWorkspaceWorkflowsFixture,
    );
    connection.queryClient.setQueryData(
      taskQueryKeys.unfilteredRepoData({ workspaceId: "workspace-1", repoPath: "/repo" }),
      {
        tasks: [task],
      },
    );
    return connection;
  });
  return (
    <ClientConnectionProvider connection={connection}>
      <ActiveWorkspaceContext
        value={{
          activeWorkspace: {
            workspaceId: "workspace-1",
            workspaceName: "Workspace",
            repoPath: "/repo",
          },
          setActiveWorkspace: () => {},
        }}
      >
        {children}
      </ActiveWorkspaceContext>
    </ClientConnectionProvider>
  );
}

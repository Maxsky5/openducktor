import { ActiveWorkspaceContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import type { PropsWithChildren, ReactElement } from "react";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import type { WorkspaceStateContextValue } from "@/types/state-slices";
import { createWorkspaceStateFixture } from "./shared-test-fixtures";

/** The workspace state and the active workspace that the shared task hooks read. */
export function WorkspaceProviders({
  value = createWorkspaceStateFixture(),
  children,
}: PropsWithChildren<{ value?: WorkspaceStateContextValue }>): ReactElement {
  return (
    <WorkspaceStateContext.Provider value={value}>
      <ActiveWorkspaceContext
        value={{ activeWorkspace: value.activeWorkspace, setActiveWorkspace: () => {} }}
      >
        {children}
      </ActiveWorkspaceContext>
    </WorkspaceStateContext.Provider>
  );
}

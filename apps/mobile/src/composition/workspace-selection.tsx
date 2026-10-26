import type { WorkspaceRecord } from "@openducktor/contracts";
import {
  useActiveWorkspaceContext,
  WorkspaceScopeContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { workspaceListQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  startTransition,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { SELECTED_WORKSPACE_KEY } from "@/device-data/device-records";
import { resolveWorkspaceSelection } from "./workspace-selection-model";

const EMPTY_WORKSPACES: WorkspaceRecord[] = [];

const activeWorkspaceOf = ({ workspaceId, workspaceName, repoPath }: WorkspaceRecord) => ({
  workspaceId,
  workspaceName,
  repoPath,
});

export type MobileWorkspacesValue = {
  /** The open workspaces of the host, in host order. */
  workspaces: WorkspaceRecord[];
  /** The workspace that Sessions and Tasks show. Other clients keep their own selection. */
  selectedWorkspace: WorkspaceRecord | null;
  isLoading: boolean;
  error: string | null;
  selectWorkspace: (workspaceId: string) => void;
  refreshWorkspaces: () => Promise<void>;
};

const MobileWorkspacesContext = createContext<MobileWorkspacesValue | null>(null);

/**
 * Keeps the workspace choice of this app for the active saved host. It never calls
 * `workspaceSelect`, because that changes the workspace that every client opens.
 */
export function WorkspaceSelectionProvider({ children }: PropsWithChildren): ReactElement {
  const { storage, feedback } = useClientConnection();
  const { setActiveWorkspace } = useActiveWorkspaceContext();
  const query = useQuery(workspaceListQueryOptions());
  const workspaces = query.data ?? EMPTY_WORKSPACES;
  const [storedId, setStoredId] = useState(() => storage.getItem(SELECTED_WORKSPACE_KEY));
  const knownNames = useRef(new Map<string, string>());

  const selection = useMemo(
    () => (query.data ? resolveWorkspaceSelection(storedId, query.data) : null),
    [query.data, storedId],
  );
  const selectedWorkspace = selection?.workspace ?? null;

  useEffect(() => {
    for (const workspace of workspaces) {
      knownNames.current.set(workspace.workspaceId, workspace.workspaceName);
    }
  }, [workspaces]);

  useEffect(() => {
    if (!selection) return;
    const nextId = selection.workspace?.workspaceId ?? null;
    if (selection.replaced) {
      const previousName = knownNames.current.get(selection.replaced.previousWorkspaceId);
      const subject = previousName ? `${previousName} is` : "The workspace you used last is";
      const next = selection.workspace
        ? `Showing ${selection.workspace.workspaceName}.`
        : "Open a workspace in the desktop or web app.";
      feedback.show("info", `${subject} no longer open on the host.`, { description: next });
    }
    if (nextId === storedId) return;
    if (nextId) storage.setItem(SELECTED_WORKSPACE_KEY, nextId);
    else storage.removeItem(SELECTED_WORKSPACE_KEY);
    setStoredId(nextId);
  }, [feedback, selection, storage, storedId]);

  // Follows a selection that the resolver changes, such as a closed workspace.
  useEffect(() => {
    setActiveWorkspace(selectedWorkspace ? activeWorkspaceOf(selectedWorkspace) : null);
  }, [selectedWorkspace, setActiveWorkspace]);

  const selectWorkspace = useCallback(
    (workspaceId: string) => {
      storage.setItem(SELECTED_WORKSPACE_KEY, workspaceId);
      const workspace = workspaces.find((entry) => entry.workspaceId === workspaceId);
      // A new workspace renders every open screen again. As a transition, that render waits for
      // the push or the dismiss that the same tap starts, and gives way to the frames of its
      // animation.
      startTransition(() => {
        setStoredId(workspaceId);
        // The effect above runs after the effects of the screens, so the first render of the new
        // selection would read the tasks of the old workspace. One update sets both.
        if (workspace) setActiveWorkspace(activeWorkspaceOf(workspace));
      });
    },
    [setActiveWorkspace, storage, workspaces],
  );
  const { refetch } = query;
  const refreshWorkspaces = useCallback(async () => {
    const result = await refetch();
    if (result.error) throw result.error;
  }, [refetch]);

  const value = useMemo<MobileWorkspacesValue>(
    () => ({
      workspaces,
      selectedWorkspace,
      isLoading: query.isPending,
      error: query.error ? errorMessage(query.error) : null,
      selectWorkspace,
      refreshWorkspaces,
    }),
    [
      query.error,
      query.isPending,
      refreshWorkspaces,
      selectWorkspace,
      selectedWorkspace,
      workspaces,
    ],
  );
  const scope = useMemo(
    () => ({ workspaces, activeWorkspace: selectedWorkspace }),
    [selectedWorkspace, workspaces],
  );

  return (
    <MobileWorkspacesContext value={value}>
      <WorkspaceScopeContext value={scope}>{children}</WorkspaceScopeContext>
    </MobileWorkspacesContext>
  );
}

export const useMobileWorkspaces = (): MobileWorkspacesValue => {
  const value = use(MobileWorkspacesContext);
  if (!value) throw new Error("Workspace views need the workspace selection of a host connection.");
  return value;
};

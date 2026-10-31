import type { SettingsRepoConfig, SettingsSnapshot } from "@openducktor/contracts";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useMemo, useReducer } from "react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { settingsSnapshotQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import {
  chooseInitialSettingsWorkspaceId,
  type SettingsWorkspaceSelectionPolicy,
} from "./settings-workspace-selection";

export type SettingsSnapshotDraftUpdater = (
  current: SettingsSnapshot | null,
) => SettingsSnapshot | null;

type SettingsSnapshotState = {
  policy: SettingsWorkspaceSelectionPolicy | null;
  loadedSnapshot: SettingsSnapshot | null;
  snapshotDraft: SettingsSnapshot | null;
  selectedWorkspaceId: string | null;
  readError: string | null;
};

type SettingsSnapshotAction =
  | { type: "closed" }
  | { type: "opened"; snapshot: SettingsSnapshot | null; policy: SettingsWorkspaceSelectionPolicy }
  | { type: "draftUpdated"; updater: SettingsSnapshotDraftUpdater }
  | { type: "readSettled"; error: string | null }
  | { type: "workspaceSelected"; workspaceId: string | null };

const CLOSED: SettingsSnapshotState = {
  policy: null,
  loadedSnapshot: null,
  snapshotDraft: null,
  selectedWorkspaceId: null,
  readError: null,
};

/** Each opening gets a draft from the cached snapshot before its first visible render. */
export function useSettingsModalSnapshotState({
  open,
  workspaceSelectionPolicy,
}: {
  open: boolean;
  workspaceSelectionPolicy: SettingsWorkspaceSelectionPolicy;
}) {
  const query = useQuery({
    ...settingsSnapshotQueryOptions(),
    enabled: open,
    refetchOnMount: false,
  });
  const [state, dispatch] = useReducer(settingsSnapshotReducer, CLOSED);
  const action = settingsReadAction(state, open, workspaceSelectionPolicy, query);
  if (action) dispatch(action);
  const { loadedSnapshot, snapshotDraft, selectedWorkspaceId } = state;
  const setSnapshotDraft = useCallback(
    (updater: SettingsSnapshotDraftUpdater) => dispatch({ type: "draftUpdated", updater }),
    [],
  );
  const setSelectedWorkspaceId = useCallback((next: string): void => {
    dispatch({ type: "workspaceSelected", workspaceId: next });
  }, []);
  const { refetch } = query;
  const retrySettings = useCallback(() => {
    void refetch();
  }, [refetch]);
  const selection = useMemo(
    () => getWorkspaceSelection(snapshotDraft, selectedWorkspaceId, workspaceSelectionPolicy),
    [snapshotDraft, selectedWorkspaceId, workspaceSelectionPolicy],
  );
  if (snapshotDraft && !selection.selectedRepoConfig) {
    const workspaceId = chooseInitialSettingsWorkspaceId(snapshotDraft, workspaceSelectionPolicy);
    if (workspaceId !== selectedWorkspaceId) dispatch({ type: "workspaceSelected", workspaceId });
  }
  return {
    loadedSnapshot,
    snapshotDraft,
    setSnapshotDraft,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    ...selection,
    isLoadingSettings: open && query.isPending && state.readError === null,
    settingsError: open ? state.readError : null,
    retrySettings,
  };
}

function settingsReadAction(
  state: SettingsSnapshotState,
  open: boolean,
  policy: SettingsWorkspaceSelectionPolicy,
  query: Pick<UseQueryResult<SettingsSnapshot>, "data" | "error" | "isPending">,
): SettingsSnapshotAction | null {
  if (!open) return state.policy === null ? null : { type: "closed" };
  if (state.policy !== policy || (state.loadedSnapshot === null && query.data !== undefined)) {
    return { type: "opened", snapshot: query.data ?? null, policy };
  }
  // A failed read stays visible while Retry has no result yet.
  const error = query.error ? errorMessage(query.error) : null;
  if (!query.isPending && state.readError !== error) return { type: "readSettled", error };
  return null;
}

function settingsSnapshotReducer(
  state: SettingsSnapshotState,
  action: SettingsSnapshotAction,
): SettingsSnapshotState {
  switch (action.type) {
    case "closed":
      return CLOSED;
    case "opened":
      return {
        policy: action.policy,
        loadedSnapshot: action.snapshot,
        snapshotDraft: action.snapshot,
        selectedWorkspaceId: action.snapshot
          ? chooseInitialSettingsWorkspaceId(action.snapshot, action.policy)
          : null,
        readError: state.readError,
      };
    case "readSettled":
      return { ...state, readError: action.error };
    case "draftUpdated":
      return { ...state, snapshotDraft: action.updater(state.snapshotDraft) };
    case "workspaceSelected":
      return { ...state, selectedWorkspaceId: action.workspaceId };
  }
}

function getWorkspaceSelection(
  draft: SettingsSnapshot | null,
  workspaceId: string | null,
  policy: SettingsWorkspaceSelectionPolicy,
) {
  const selectedRepoConfig: SettingsRepoConfig | null = workspaceId
    ? (draft?.workspaces[workspaceId] ?? null)
    : null;
  return {
    selectedRepoConfig,
    workspaceIds: draft ? Object.keys(draft.workspaces).sort() : [],
    requiredWorkspaceSelectionUnresolved:
      policy.kind === "required" && draft !== null && workspaceId === null,
    requiredWorkspaceRepoPath: policy.kind === "required" ? policy.repoPath : null,
  };
}

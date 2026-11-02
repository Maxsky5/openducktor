import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  applySettingsSnapshotPatch,
  jsonValuesEqual,
  retainSettingsSnapshotUpdateTargets,
  type SettingsRepoConfig,
  type SettingsSnapshot,
  type SettingsSnapshotSaveInput,
} from "@openducktor/contracts";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { settingsSnapshotQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import { rebaseSettingsDraft } from "./settings-draft-rebase";
import {
  chooseInitialSettingsWorkspaceId,
  type SettingsWorkspaceSelectionPolicy,
} from "./settings-workspace-selection";

type UseSettingsModalSnapshotStateArgs = {
  open: boolean;
  workspaceSelectionPolicy: SettingsWorkspaceSelectionPolicy;
};

type SettingsModalSnapshotState = {
  acknowledgeSave: (partial: boolean, submitted: SettingsSnapshotSaveInput) => void;
  retainDraft: () => void;
  discardDraft: () => void;
  draftBaseline: SettingsSnapshot | null;
  unavailableTargetError: string | null;
  loadedSnapshot: SettingsSnapshot | null;
  snapshotDraft: SettingsSnapshot | null;
  setSnapshotDraft: (updater: SettingsSnapshotDraftUpdater) => void;
  selectedWorkspaceId: string | null;
  setSelectedWorkspaceId: (next: string) => void;
  workspaceIds: string[];
  selectedRepoConfig: SettingsRepoConfig | null;
  isLoadingSettings: boolean;
  settingsError: string | null;
  retrySettings: () => void;
  requiredWorkspaceSelectionUnresolved: boolean;
  requiredWorkspaceRepoPath: string | null;
};

export type SettingsSnapshotDraftUpdater = (
  current: SettingsSnapshot | null,
) => SettingsSnapshot | null;

type RetainedSettingsDraft = { baseline: SettingsSnapshot; draft: SettingsSnapshot };

type SettingsSnapshotState = {
  policy: SettingsWorkspaceSelectionPolicy | null;
  draftBaseline: SettingsSnapshot | null;
  loadedSnapshot: SettingsSnapshot | null;
  snapshotDraft: SettingsSnapshot | null;
  selectedWorkspaceId: string | null;
  readError: string | null;
};

type SettingsSnapshotAction =
  | { type: "acknowledged"; baseline: SettingsSnapshot; draft: SettingsSnapshot }
  | { type: "discarded" }
  | {
      type: "opened";
      snapshot: SettingsSnapshot | null;
      policy: SettingsWorkspaceSelectionPolicy;
      retained: RetainedSettingsDraft | null;
    }
  | { type: "received"; snapshot: SettingsSnapshot; retained: RetainedSettingsDraft | null }
  | { type: "readSettled"; error: string | null }
  | { type: "closed" }
  | { type: "draftUpdated"; updater: SettingsSnapshotDraftUpdater }
  | { type: "workspaceSelected"; workspaceId: string | null };

const CLOSED: SettingsSnapshotState = {
  policy: null,
  draftBaseline: null,
  loadedSnapshot: null,
  snapshotDraft: null,
  selectedWorkspaceId: null,
  readError: null,
};

/** Each opening gets a draft from the cached snapshot before its first visible render. */
export const useSettingsModalSnapshotState = ({
  open,
  workspaceSelectionPolicy,
}: UseSettingsModalSnapshotStateArgs): SettingsModalSnapshotState => {
  const connection = useClientConnection();
  const savedQuery = useQuery({
    ...settingsSnapshotQueryOptions(),
    enabled: open,
    refetchOnMount: false,
  });
  const [state, dispatch] = useReducer(settingsSnapshotReducer, CLOSED);
  const action = settingsReadAction(
    state,
    open,
    workspaceSelectionPolicy,
    savedQuery,
    connection.drafts.settings.retained,
  );
  if (action) dispatch(action);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const retainDraft = useCallback(() => {
    const { draftBaseline, snapshotDraft } = stateRef.current;
    if (draftBaseline && snapshotDraft)
      connection.drafts.settings.retained = jsonValuesEqual(draftBaseline, snapshotDraft)
        ? null
        : { baseline: draftBaseline, draft: snapshotDraft };
  }, [connection]);
  const discardDraft = useCallback(() => {
    connection.drafts.settings.retained = null;
    stateRef.current = {
      ...stateRef.current,
      draftBaseline: stateRef.current.loadedSnapshot,
      snapshotDraft: stateRef.current.loadedSnapshot,
    };
    dispatch({ type: "discarded" });
  }, [connection]);
  useEffect(() => () => retainDraft(), [retainDraft]);
  const acknowledgeSave = useCallback(
    (partial: boolean, submitted: SettingsSnapshotSaveInput) => {
      const { draftBaseline } = stateRef.current;
      if (!draftBaseline) return;
      const draft = applySettingsSnapshotPatch(draftBaseline, submitted, { preferences: true });
      const baseline = partial
        ? applySettingsSnapshotPatch(draftBaseline, submitted, { preferences: false })
        : draft;
      connection.drafts.settings.retained = partial ? { baseline, draft } : null;
      stateRef.current = { ...stateRef.current, draftBaseline: baseline, snapshotDraft: draft };
      dispatch({ type: "acknowledged", baseline, draft });
    },
    [connection],
  );
  useEffect(() => {
    if (open && connection.drafts.settings.retained && state.draftBaseline && state.snapshotDraft)
      connection.drafts.settings.retained = {
        baseline: state.draftBaseline,
        draft: state.snapshotDraft,
      };
  }, [connection, open, state.draftBaseline, state.snapshotDraft]);
  useEffect(() => {
    if (open) return;
    retainDraft();
    dispatch({ type: "closed" });
  }, [open, retainDraft]);
  const { loadedSnapshot, draftBaseline, snapshotDraft, selectedWorkspaceId } = state;
  const setSnapshotDraft = useCallback(
    (updater: SettingsSnapshotDraftUpdater) => dispatch({ type: "draftUpdated", updater }),
    [],
  );
  const setSelectedWorkspaceId = useCallback((next: string): void => {
    dispatch({ type: "workspaceSelected", workspaceId: next });
  }, []);
  const { refetch } = savedQuery;
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
    acknowledgeSave,
    retainDraft,
    discardDraft,
    draftBaseline,
    unavailableTargetError: getUnavailableTargetError(draftBaseline, snapshotDraft, loadedSnapshot),
    loadedSnapshot,
    snapshotDraft,
    setSnapshotDraft,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    ...selection,
    isLoadingSettings: open && savedQuery.isPending && state.readError === null,
    settingsError: open ? state.readError : null,
    retrySettings,
  };
};

function settingsReadAction(
  state: SettingsSnapshotState,
  open: boolean,
  policy: SettingsWorkspaceSelectionPolicy,
  query: Pick<UseQueryResult<SettingsSnapshot>, "data" | "error" | "isPending">,
  retained: RetainedSettingsDraft | null,
): SettingsSnapshotAction | null {
  // The close effect keeps the draft before it resets the state.
  if (!open) return null;
  if (state.policy !== policy) {
    return { type: "opened", snapshot: query.data ?? null, policy, retained };
  }
  if (query.data !== undefined && query.data !== state.loadedSnapshot) {
    return { type: "received", snapshot: query.data, retained };
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
    case "acknowledged":
      return { ...state, draftBaseline: action.baseline, snapshotDraft: action.draft };
    case "closed":
      return CLOSED;
    case "discarded":
      return { ...state, draftBaseline: state.loadedSnapshot, snapshotDraft: state.loadedSnapshot };
    case "opened": {
      const opened = { ...state, policy: action.policy, selectedWorkspaceId: null };
      return action.snapshot ? receiveSnapshot(opened, action.snapshot, action.retained) : opened;
    }
    case "received":
      return receiveSnapshot(state, action.snapshot, action.retained);
    case "readSettled":
      return { ...state, readError: action.error };
    case "draftUpdated":
      return { ...state, snapshotDraft: action.updater(state.snapshotDraft) };
    case "workspaceSelected":
      return { ...state, selectedWorkspaceId: action.workspaceId };
  }
}

/** Rebase the open or retained draft on the received snapshot. */
function receiveSnapshot(
  state: SettingsSnapshotState,
  snapshot: SettingsSnapshot,
  retainedDraft: RetainedSettingsDraft | null,
): SettingsSnapshotState {
  const retained =
    state.draftBaseline && state.snapshotDraft
      ? { baseline: state.draftBaseline, draft: state.snapshotDraft }
      : retainedDraft;
  let snapshotDraft = snapshot;
  let draftBaseline = snapshot;
  if (retained) {
    snapshotDraft = rebaseSettingsDraft(retained.baseline, retained.draft, snapshot);
    draftBaseline = retainSettingsSnapshotUpdateTargets(
      retained.baseline,
      retained.draft,
      snapshot,
    );
  }
  return {
    ...state,
    loadedSnapshot: snapshot,
    draftBaseline,
    snapshotDraft,
    selectedWorkspaceId:
      state.selectedWorkspaceId && snapshotDraft.workspaces[state.selectedWorkspaceId]
        ? state.selectedWorkspaceId
        : state.policy
          ? chooseInitialSettingsWorkspaceId(snapshotDraft, state.policy)
          : null,
  };
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

const getUnavailableTargetError = (
  draftBaseline: SettingsSnapshot | null,
  snapshotDraft: SettingsSnapshot | null,
  loadedSnapshot: SettingsSnapshot | null,
): string | null => {
  const missingRole = snapshotDraft?.customAgentRoles.find((role) => {
    const original = draftBaseline?.customAgentRoles.find((saved) => saved.id === role.id);
    return (
      original !== undefined &&
      !loadedSnapshot?.customAgentRoles.some((saved) => saved.id === role.id) &&
      !jsonValuesEqual(original, role)
    );
  });
  if (missingRole)
    return `Custom role ${missingRole.name || missingRole.id} is no longer available. Copy your edits or discard them with Cancel.`;
  const missingWorkspace = Object.keys(snapshotDraft?.workspaces ?? {}).find(
    (id) =>
      !loadedSnapshot?.workspaces[id] &&
      draftBaseline?.workspaces[id] &&
      !jsonValuesEqual(draftBaseline.workspaces[id], snapshotDraft?.workspaces[id]),
  );
  if (missingWorkspace)
    return `Workspace ${missingWorkspace} is no longer available. Copy your edits or discard them with Cancel.`;
  return null;
};

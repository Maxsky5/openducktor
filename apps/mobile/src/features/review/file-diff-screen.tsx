import { Stack, useLocalSearchParams } from "expo-router";
import { type ReactElement, useCallback, useMemo } from "react";
import type { WorkOwner } from "@/features/work-owner/work-owner-context";
import { WorkHeaderTitle } from "@/features/work-owner/work-header-title";
import { WorkOwnerScreen } from "@/features/work-owner/work-owner-screen";
import { useCommandGate } from "@/host-session/active-session-context";
import { IconButton } from "@/ui/icon-button";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import {
  type ChangedFileGroup,
  findChangedFileDiff,
  groupDiffScope,
  isChangedFileGroup,
} from "./changes-model";
import { FileDiffView } from "./file-diff-view";

const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1) || path;

const directoryOf = (path: string): string | null => {
  const slash = path.lastIndexOf("/");
  return slash > 0 ? path.slice(0, slash) : null;
};

/**
 * The whole File Diff of one changed file. The Changes view opens it from the file menu, and from
 * an inline diff that stops early.
 */
export function FileDiffScreen(): ReactElement {
  const params = useLocalSearchParams<{ path?: string; group?: string }>();
  const { path } = params;
  const group = params.group && isChangedFileGroup(params.group) ? params.group : null;
  if (!path || !group) {
    return (
      <WorkOwnerScreen title="File Diff" diffs={false}>
        {() => (
          <EmptyState
            icon="file-question"
            title="Incomplete Link"
            message="It does not name a changed file. Open the file again from Changes."
          />
        )}
      </WorkOwnerScreen>
    );
  }
  return (
    <WorkOwnerScreen title={fileName(path)} diffs>
      {(owner) => <FileDiffContent owner={owner} path={path} group={group} />}
    </WorkOwnerScreen>
  );
}

function FileDiffContent({
  owner,
  path,
  group,
}: {
  owner: WorkOwner;
  path: string;
  group: ChangedFileGroup;
}): ReactElement {
  const gate = useCommandGate();
  const { diffData, manualRefresh } = owner.git;
  const diff = findChangedFileDiff(diffData, group, path);
  const scope = groupDiffScope(group);
  const scopeState = diffData.scopeStatesByScope[scope];
  const refresh = useCallback(() => {
    void manualRefresh.refresh();
  }, [manualRefresh]);
  const headerRight = useCallback(
    () => (
      <IconButton
        icon="refresh"
        accessibilityLabel={manualRefresh.isRefreshing ? "Refreshing the diff" : "Refresh the diff"}
        onPress={refresh}
        command
        disabled={manualRefresh.isRefreshing}
      />
    ),
    [manualRefresh.isRefreshing, refresh],
  );
  const options = useMemo(
    () => ({
      title: fileName(path),
      headerTitle: () => <WorkHeaderTitle title={fileName(path)} subtitle={directoryOf(path)} />,
      headerRight,
    }),
    [headerRight, path],
  );
  let content: ReactElement;
  if (diff) {
    content = (
      <FileDiffView
        owner={owner}
        diff={diff}
        group={group}
        refreshError={manualRefresh.refreshError ?? scopeState.error}
      />
    );
  } else if (scopeState.error) {
    content = (
      <ErrorState
        title="Could Not Read the Diff"
        message={scopeState.error}
        onRetry={gate.open ? refresh : undefined}
      />
    );
  } else if (!diffData.loadedScopesByScope[scope]) {
    content = <LoadingState label="Loading the diff" />;
  } else {
    content = (
      <EmptyState
        icon="file-question"
        title="No Changes Now"
        message="A refresh or a commit removed this file from the changes. Go back to Changes to see the current list."
      />
    );
  }
  return (
    <>
      <Stack.Screen options={options} />
      {content}
    </>
  );
}

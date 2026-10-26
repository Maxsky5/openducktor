import type { ChatFileScope } from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { workspaceFileTreeQueryOptions } from "@openducktor/frontend-core/queries/filesystem";
import { FlashList, type ListRenderItem } from "@shopify/flash-list";
import { useQuery } from "@tanstack/react-query";
import {
  type NativeStackNavigationOptions,
  Stack,
  useIsFocused,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import { type ReactElement, useCallback, useMemo, useState } from "react";
import { type DimensionValue, ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { WorkOwner } from "@/features/work-owner/work-owner-context";
import { toWorkOwnerParams } from "@/features/work-owner/work-owner-params";
import { WorkOwnerScreen } from "@/features/work-owner/work-owner-screen";
import { useCommandGate } from "@/host-session/active-session-context";
import { routes } from "@/navigation/routes";
import { useSearchBarColors } from "@/navigation/stack-theme";
import { useClipboardCopy } from "@/platform/use-clipboard-copy";
import { useAppTheme } from "@/theme/app-theme-context";
import { IconButton } from "@/ui/icon-button";
import { SkeletonFrame } from "@/ui/placeholders";
import { EmptyState, ErrorState } from "@/ui/states";
import { Callout } from "@/ui/callout";
import { Text } from "@/ui/text";
import { ListRefreshControl } from "@/ui/refresh-control";
import { useScreenEndSpace } from "@/ui/screen";
import { usePullRefresh } from "@/ui/use-pull-refresh";
import { useWideLayout } from "@/ui/use-wide-layout";
import { FileTreeRowPlaceholder, FileTreeRowView } from "./file-tree-row";
import { FileViewer } from "./file-viewer";
import {
  directoryRows,
  type FileTreeRow,
  type FilesViewState,
  filesViewState,
  fileTreeIndex,
  hasDirectory,
  searchFileRows,
} from "./file-tree-model";
import { fileScopeOf } from "./file-scope";

const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1) || path;

/**
 * The Files view: one folder of the task worktree or chat directory. A folder opens as its own
 * screen, so Back returns to its parent. The search bar finds files in the folder and below it.
 */
export function FilesScreen(): ReactElement {
  const { dir } = useLocalSearchParams<{ dir?: string }>();
  const directory = dir ?? "";
  return (
    <WorkOwnerScreen
      title={directory ? nameOf(directory) : "Files"}
      diffs={false}
      skeleton={<FilesSkeleton rootPath={null} />}
    >
      {(owner) => <FilesContent owner={owner} directory={directory} />}
    </WorkOwnerScreen>
  );
}

/** The file tree of the working directory. It reads only while the screen has focus. */
const useFileTree = (owner: WorkOwner, focused: boolean) => {
  const { git } = owner;
  const { workingDirectory } = git;
  return useQuery({
    ...workspaceFileTreeQueryOptions(
      workingDirectory ?? "__inactive_file_tree__",
      git.fileTreeTargetBranch,
      git.fileTreeBranchKey,
      fileScopeOf(owner),
    ),
    enabled:
      focused &&
      workingDirectory !== null &&
      !git.workingDirectoryPending &&
      git.workingDirectoryUnavailableReason === null,
  });
};

function FilesContent({ owner, directory }: { owner: WorkOwner; directory: string }): ReactElement {
  const router = useRouter();
  const focused = useIsFocused();
  const gate = useCommandGate();
  const theme = useAppTheme();
  const endSpace = useScreenEndSpace(theme.space.xxxl);
  // Tablets and wide landscape show the folder and the file side by side.
  const wide = useWideLayout();
  const { workingDirectory, workingDirectoryPending, workingDirectoryUnavailableReason } =
    owner.git;
  const tree = useFileTree(owner, focused);
  const rootPath = tree.data?.rootPath ?? workingDirectory;
  const entries = tree.data?.entries;
  const index = useMemo(() => fileTreeIndex(entries ?? NO_ENTRIES), [entries]);
  const [query, setQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const searching = query.trim().length > 0;
  const rows = useMemo(
    () => (searching ? searchFileRows(index, query, directory) : directoryRows(index, directory)),
    [directory, index, query, searching],
  );
  const ownerParams = useMemo(() => toWorkOwnerParams(owner.ref), [owner.ref]);
  const onPressRow = useCallback(
    (row: FileTreeRow) => {
      if (row.kind === "directory") {
        router.push(routes.files(ownerParams, row.path));
        return;
      }
      if (wide) setSelectedPath(row.path);
      else router.push(routes.file(ownerParams, row.path));
    },
    [ownerParams, router, wide],
  );
  const { refetch, isFetching } = tree;
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  // The pull gesture shows its own progress. Reads that start on focus show none.
  const { pulling, pull: pullRefresh } = usePullRefresh(refetch);
  const loaded = tree.data !== undefined;
  const searchColors = useSearchBarColors();
  const options = useMemo(() => {
    const next: NativeStackNavigationOptions = {
      title: directory ? nameOf(directory) : "Files",
      headerRight: () => (
        <IconButton
          icon="refresh"
          accessibilityLabel={isFetching ? "Refreshing files" : "Refresh files"}
          onPress={refresh}
          command
          disabled={isFetching || workingDirectory === null}
        />
      ),
    };
    if (loaded) {
      next.headerSearchBarOptions = {
        ...searchColors,
        placeholder: directory
          ? `Search in ${nameOf(directory)}`
          : `Search ${index.fileCount} Files`,
        autoCapitalize: "none",
        onChangeText: (event) => setQuery(event.nativeEvent.text),
        onCancelButtonPress: () => setQuery(""),
      };
    }
    return next;
  }, [directory, index.fileCount, isFetching, loaded, refresh, searchColors, workingDirectory]);
  const renderItem = useCallback<ListRenderItem<FileTreeRow>>(
    ({ item }) => (
      <FileTreeRowView
        row={item}
        selected={wide && item.path === selectedPath}
        onPress={onPressRow}
      />
    ),
    [onPressRow, selectedPath, wide],
  );
  const closePreview = useCallback(() => setSelectedPath(null), []);

  const view = filesViewState({
    directoryPending: workingDirectoryPending,
    unavailableReason: workingDirectoryUnavailableReason,
    rootPath,
    loaded,
    error: tree.error,
    folderFound: hasDirectory(index, directory),
  });
  const body =
    view.kind === "ready" ? (
      <FlashList
        data={rows}
        renderItem={renderItem}
        keyExtractor={keyOf}
        getItemType={typeOf}
        extraData={renderItem}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentInsetAdjustmentBehavior="automatic"
        // The safe area sets this end padding. It changes only on rotation and moves no row.
        // react-doctor-disable-next-line react-doctor/rn-scrollview-dynamic-padding
        contentContainerStyle={{ paddingBottom: endSpace }}
        refreshControl={
          gate.open ? (
            <ListRefreshControl refreshing={pulling} onRefresh={pullRefresh} />
          ) : undefined
        }
        ListHeaderComponent={
          <FilesListHeader
            rootPath={directory === "" && !searching ? view.rootPath : null}
            refreshError={tree.error}
          />
        }
        ListEmptyComponent={<FilesListEmpty query={searching ? query.trim() : null} />}
      />
    ) : (
      <FilesStatus
        view={view}
        directory={directory}
        rootPath={directory === "" ? rootPath : null}
        onRetry={gate.open ? refresh : undefined}
      />
    );

  return (
    <>
      <Stack.Screen options={options} />
      {wide ? (
        <View style={styles.split}>
          <View style={styles.treePane}>{body}</View>
          <View style={styles.fill}>
            <FilePreview
              rootPath={rootPath}
              selectedPath={selectedPath}
              scope={fileScopeOf(owner)}
              onClose={closePreview}
            />
          </View>
        </View>
      ) : (
        body
      )}
    </>
  );
}

/** The Files view while it has no list: a load, a failure, or a missing folder. */
function FilesStatus({
  view,
  directory,
  rootPath,
  onRetry,
}: {
  view: Exclude<FilesViewState, { kind: "ready" }>;
  directory: string;
  /** The working directory that the top folder shows above its files, once it is known. */
  rootPath: string | null;
  onRetry: (() => void) | undefined;
}): ReactElement {
  switch (view.kind) {
    case "loading":
      return <FilesSkeleton rootPath={rootPath} />;
    case "unavailable":
      return <EmptyState icon="folder-x" title="Files Unavailable" message={view.reason} />;
    case "failed":
      return (
        <ErrorState
          title="Could Not Read the Files"
          message={errorMessage(view.error)}
          onRetry={onRetry}
        />
      );
    case "missing_folder":
      return (
        <EmptyState
          icon="folder-x"
          title="Folder Not Found"
          message={`The working directory has no folder ${directory} now. Go back to its parent folder.`}
        />
      );
  }
}

/** The working directory of the top folder, and a refresh that failed after the first read. */
function FilesListHeader({
  rootPath,
  refreshError,
}: {
  /** The working directory to show, or null in a subfolder and during a search. */
  rootPath: string | null;
  refreshError: Error | null;
}): ReactElement {
  return (
    <View style={styles.header}>
      {rootPath ? <WorkingDirectory rootPath={rootPath} /> : null}
      {refreshError ? (
        <Callout
          tone="destructive"
          title="Refresh failed"
          message={`${errorMessage(refreshError)} The list shows the last loaded files.`}
        />
      ) : null}
    </View>
  );
}

/** Name widths that change from row to row, as real file names do: the folders, then the files. */
const PLACEHOLDER_NAMES: readonly { id: string; width: DimensionValue }[] = [
  { id: "name-1", width: "24%" },
  { id: "name-2", width: "18%" },
  { id: "name-3", width: "30%" },
  { id: "name-4", width: "42%" },
  { id: "name-5", width: "34%" },
  { id: "name-6", width: "52%" },
  { id: "name-7", width: "28%" },
  { id: "name-8", width: "46%" },
  { id: "name-9", width: "38%" },
  { id: "name-10", width: "56%" },
  { id: "name-11", width: "32%" },
  { id: "name-12", width: "44%" },
];

/**
 * The folder for its first load, in the layout of the loaded tree: the working directory of the
 * top folder when it is known, and the tree rows. The tree then takes the place of each part.
 */
function FilesSkeleton({ rootPath }: { rootPath: string | null }): ReactElement {
  return (
    <ScrollView scrollEnabled={false} contentInsetAdjustmentBehavior="automatic">
      <FilesListHeader rootPath={rootPath} refreshError={null} />
      <SkeletonFrame label="Loading files">
        {PLACEHOLDER_NAMES.map((name) => (
          <FileTreeRowPlaceholder key={name.id} nameWidth={name.width} />
        ))}
      </SkeletonFrame>
    </ScrollView>
  );
}

/** An empty folder, or a search without results. */
function FilesListEmpty({ query }: { query: string | null }): ReactElement {
  if (query === null) {
    return <EmptyState icon="folder" title="Empty Folder" message="This folder has no files." />;
  }
  return (
    <EmptyState
      icon="search-x"
      title="No Results"
      message={`No file path in this folder holds “${query}”.`}
    />
  );
}

/** The file of the wide layout, beside the folder. */
function FilePreview({
  rootPath,
  selectedPath,
  scope,
  onClose,
}: {
  rootPath: string | null;
  selectedPath: string | null;
  scope: ChatFileScope | undefined;
  onClose: () => void;
}): ReactElement {
  if (!rootPath || !selectedPath) {
    return <EmptyState icon="file" title="No File Selected" message="Select a file to read it." />;
  }
  return (
    <FileViewer
      key={selectedPath}
      rootPath={rootPath}
      relativePath={selectedPath}
      scope={scope}
      showsPath
      onClose={onClose}
    />
  );
}

const NO_ENTRIES: never[] = [];
const keyOf = (row: FileTreeRow): string => row.key;
// A search result has a second line with its folder.
const typeOf = (row: FileTreeRow): string => (row.directory === null ? row.kind : "result");

/** The working directory of the tree, with a copy control, as the desktop file explorer header. */
function WorkingDirectory({ rootPath }: { rootPath: string }): ReactElement {
  const { copyText } = useClipboardCopy();
  const copy = useCallback(() => {
    void copyText(rootPath, {
      copied: "Working directory copied.",
      failed: "The working directory was not copied.",
    });
  }, [copyText, rootPath]);
  return (
    <View style={styles.rootCard}>
      <View style={styles.rootText} accessible accessibilityLabel={`Working directory ${rootPath}`}>
        <Text variant="caption1" style={styles.rootLabel}>
          Working dir
        </Text>
        <Text variant="monoSmall" numberOfLines={1} ellipsizeMode="middle">
          {rootPath}
        </Text>
      </View>
      <IconButton
        icon="copy"
        size={16}
        color="secondaryLabel"
        accessibilityLabel="Copy working directory"
        onPress={copy}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  fill: { flex: 1 },
  split: { flex: 1, flexDirection: "row" },
  treePane: {
    width: "36%",
    minWidth: 280,
    maxWidth: 420,
    borderRightWidth: theme.hairline,
    borderRightColor: theme.desktop.border,
  },
  header: {
    gap: theme.space.sm,
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.xs,
    paddingBottom: theme.space.sm,
  },
  // The desktop header: a muted card with an outline, a small label, and the path in mono.
  rootCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.xs,
    paddingLeft: theme.space.md,
    borderRadius: theme.radius.sm,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.colors.insetFill,
  },
  rootText: { flex: 1, minWidth: 0, gap: 1, paddingVertical: theme.space.sm },
  rootLabel: { color: theme.desktop.mutedForeground },
}));

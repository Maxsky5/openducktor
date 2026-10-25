import type { WorkspaceRecord } from "@openducktor/contracts";
import { useWorkspaceActivity } from "@openducktor/frontend-core/workspace-activity/workspace-activity-context";
import { useRouter } from "expo-router";
import { memo, type ReactElement, useCallback, useState } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useMobileWorkspaces } from "@/composition/workspace-selection";
import { SheetScreen } from "@/navigation/sheet-screen";
import { StatusLabel } from "@/ui/badge";
import { Button } from "@/ui/button";
import { haptics } from "@/ui/haptics";
import { Screen } from "@/ui/screen";
import { SearchField } from "@/ui/search-field";
import { SkeletonFrame } from "@/ui/placeholders";
import { ErrorState } from "@/ui/states";
import { Callout } from "@/ui/callout";
import { ListRow, ListRowPlaceholder, ListSection } from "@/ui/surfaces";
import { Text } from "@/ui/text";
import { ListRefreshControl } from "@/ui/refresh-control";
import { usePullRefresh } from "@/ui/use-pull-refresh";
import { NoOpenWorkspaceState } from "./no-open-workspace";
import { workspaceBadgePresentations } from "./workspace-activity-badges";
import { WorkspaceTile } from "./workspace-tile";
import { TILE_SIZES } from "./workspace-tile-sizes";

const WorkspaceOption = memo(function WorkspaceOption({
  workspace,
  selected,
  onSelect,
}: {
  workspace: WorkspaceRecord;
  selected: boolean;
  onSelect: (workspaceId: string) => void;
}): ReactElement {
  const badges = workspaceBadgePresentations(useWorkspaceActivity(workspace.workspaceId));
  const badgeText = badges.map((badge) => badge.accessibilityLabel).join(", ");
  return (
    <ListRow
      title={workspace.workspaceName}
      titleLines={1}
      leading={<WorkspaceTile workspace={workspace} size="lg" active={selected} />}
      meta={
        <>
          <Text variant="monoSmall" numberOfLines={1} ellipsizeMode="middle" style={styles.path}>
            {workspace.repoPath}
          </Text>
          {badges.length > 0 ? (
            <View style={styles.badges}>
              {badges.map((badge) => (
                <StatusLabel
                  key={badge.key}
                  label={badge.label}
                  tone={badge.tone}
                  pulse={badge.key === "active"}
                />
              ))}
            </View>
          ) : null}
        </>
      }
      // A selected row shows the check mark of the list row; other rows show nothing.
      accessory="none"
      selected={selected}
      onPress={() => onSelect(workspace.workspaceId)}
      accessibilityLabel={[
        workspace.workspaceName,
        workspace.repoPath,
        selected ? "Shown" : null,
        badgeText || null,
      ]
        .filter(Boolean)
        .join(", ")}
      accessibilityHint="Shows this workspace in Sessions and Tasks on this device."
    />
  );
});

const LIST_FOOTER = "Your choice changes only this device. Other clients keep their workspace.";

/**
 * The workspaces for their first load, in the layout of the loaded list: the section title, the
 * rows with their tile, name, and path, and the footer. The list then takes the place of each part.
 */
function WorkspaceOptionsSkeleton(): ReactElement {
  return (
    <ScrollView
      scrollEnabled={false}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <SkeletonFrame label="Loading workspaces">
        <ListSection title="Open workspaces" footer={LIST_FOOTER}>
          <ListRowPlaceholder
            leadingSize={TILE_SIZES.lg}
            titleWidth="38%"
            detail={{ variant: "monoSmall", width: "72%" }}
          />
          <ListRowPlaceholder
            leadingSize={TILE_SIZES.lg}
            titleWidth="30%"
            detail={{ variant: "monoSmall", width: "64%" }}
          />
        </ListSection>
      </SkeletonFrame>
    </ScrollView>
  );
}

/** The list shows a search field from this many workspaces, as the desktop repository selector. */
const SEARCH_THRESHOLD = 7;

/** The desktop selector matches the workspace name and each folder of the repository path. */
const matchesWorkspace = (workspace: WorkspaceRecord, term: string): boolean =>
  [workspace.workspaceName, ...workspace.repoPath.split("/")].some((keyword) =>
    keyword.toLowerCase().includes(term),
  );

function WorkspaceOptions(): ReactElement {
  const router = useRouter();
  const { workspaces, selectedWorkspace, isLoading, error, selectWorkspace, refreshWorkspaces } =
    useMobileWorkspaces();
  const { pulling, pull } = usePullRefresh(refreshWorkspaces);
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const shown = term
    ? workspaces.filter((workspace) => matchesWorkspace(workspace, term))
    : workspaces;

  const selectedId = selectedWorkspace?.workspaceId ?? null;
  const select = useCallback(
    (workspaceId: string) => {
      if (workspaceId !== selectedId) haptics.selection();
      selectWorkspace(workspaceId);
      router.back();
    },
    [router, selectWorkspace, selectedId],
  );

  if (isLoading) return <WorkspaceOptionsSkeleton />;
  if (workspaces.length === 0 && error) {
    return (
      <ErrorState title="Workspaces did not load" message={error} onRetry={refreshWorkspaces} />
    );
  }
  // A failed refresh keeps the last list, so its reason shows above the list.
  const staleReason = workspaces.length > 0 ? error : null;
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<ListRefreshControl refreshing={pulling} onRefresh={pull} />}
    >
      {staleReason ? (
        <View style={styles.notice}>
          <Callout
            tone="warning"
            title="Workspaces could not refresh"
            message={staleReason}
            action={<Button label="Try Again" size="sm" variant="gray" onPress={pull} />}
          />
        </View>
      ) : null}
      {workspaces.length >= SEARCH_THRESHOLD ? (
        <View style={styles.search}>
          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder="Search workspaces"
            accessibilityLabel="Search workspaces"
          />
        </View>
      ) : null}
      {workspaces.length > 0 && shown.length === 0 ? (
        <Text variant="subhead" style={styles.empty}>
          No workspace matches the search.
        </Text>
      ) : null}
      {workspaces.length === 0 ? (
        <NoOpenWorkspaceState />
      ) : (
        <ListSection title="Open workspaces" footer={LIST_FOOTER}>
          {shown.map((workspace) => (
            <WorkspaceOption
              key={workspace.workspaceId}
              workspace={workspace}
              selected={workspace.workspaceId === selectedId}
              onSelect={select}
            />
          ))}
        </ListSection>
      )}
    </ScrollView>
  );
}

/**
 * The open workspaces of the host. Choosing one changes only this app; other clients keep the
 * workspace they show.
 */
export function WorkspaceSwitcherSheet(): ReactElement {
  return (
    <SheetScreen title="Workspaces" draggable>
      <Screen background="sheet">
        <WorkspaceOptions />
      </Screen>
    </SheetScreen>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { flexGrow: 1, paddingBottom: theme.space.xxxl },
  notice: { paddingHorizontal: theme.layout.screenPadding, paddingTop: theme.space.lg },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.md, paddingTop: 2 },
  path: { color: theme.desktop.mutedForeground },
  search: { paddingHorizontal: theme.layout.screenPadding, paddingTop: theme.space.lg },
  empty: {
    paddingHorizontal: theme.layout.screenPadding + 4,
    paddingTop: theme.space.lg,
    color: theme.desktop.mutedForeground,
  },
}));

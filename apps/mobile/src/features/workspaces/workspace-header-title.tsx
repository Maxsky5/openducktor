import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useMobileWorkspaces } from "@/composition/workspace-selection";
import { routes } from "@/navigation/routes";
import { useAppTheme } from "@/theme/app-theme-context";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { WorkspaceTile } from "./workspace-tile";

/**
 * The header title of the workspace screens: the active workspace tile of the desktop rail, the
 * workspace name, and the switcher chevrons of the desktop selector. It names the workspace that
 * this app shows and opens the workspace switcher. Use it as `headerTitle` of a screen, or above
 * a list of one workspace, such as Archived Chats.
 */
export function WorkspaceHeaderTitle(): ReactElement {
  const router = useRouter();
  const theme = useAppTheme();
  const { selectedWorkspace, isLoading, workspaces } = useMobileWorkspaces();
  let title = "Workspaces";
  if (selectedWorkspace) title = selectedWorkspace.workspaceName;
  else if (isLoading) title = "Loading…";
  else if (workspaces.length === 0) title = "No Workspace";
  return (
    <Touchable
      feedback="opacity"
      onPress={() => router.push(routes.workspaceSwitcher())}
      accessibilityRole="button"
      accessibilityLabel={
        selectedWorkspace ? `Workspace ${selectedWorkspace.workspaceName}` : title
      }
      accessibilityHint="Shows the open workspaces of the host."
      hitSlop={8}
      style={styles.control}
    >
      {selectedWorkspace ? <WorkspaceTile workspace={selectedWorkspace} size="sm" active /> : null}
      <View style={styles.titleBox}>
        <Text variant="headline" numberOfLines={1} style={styles.title}>
          {title}
        </Text>
      </View>
      <Icon name="chevron-up-down" size={14} colorValue={theme.desktop.mutedForeground} />
    </Touchable>
  );
}

const styles = StyleSheet.create((theme) => ({
  control: {
    minHeight: theme.touchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    maxWidth: 240,
  },
  titleBox: { flexShrink: 1 },
  title: { color: theme.desktop.foreground },
}));

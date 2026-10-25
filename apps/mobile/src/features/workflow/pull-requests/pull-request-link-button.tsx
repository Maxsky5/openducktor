import type { PullRequest } from "@openducktor/contracts";
import {
  PULL_REQUEST_STATE_LABELS,
  pullRequestLabel,
} from "@openducktor/frontend-core/tasks/pull-requests/pull-request-presentation";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native-unistyles";
import { useLinkOpener } from "@/rich-content/links/use-link-opener";
import { pullRequestPaint } from "@/features/tasks/presentation/task-badge-paint";
import { pullRequestIconColor } from "@/features/tasks/presentation/task-chip-paint";
import { useAppTheme } from "@/theme/app-theme-context";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";

/**
 * A pull request link, as the desktop pull request badge: an outlined capsule with the state icon
 * in its color, the pull request name, and an external link mark. It opens in the device browser,
 * and screen readers hear the state.
 */
export function PullRequestLinkButton({ pullRequest }: { pullRequest: PullRequest }): ReactElement {
  const theme = useAppTheme();
  const openLink = useLinkOpener(undefined);
  const stateLabel = PULL_REQUEST_STATE_LABELS[pullRequest.state];
  return (
    <Touchable
      feedback="scale"
      radius={999}
      onPress={() => openLink(pullRequest.url)}
      accessibilityRole="link"
      accessibilityLabel={`${pullRequestLabel(pullRequest)}, ${stateLabel}`}
      accessibilityHint="Opens the pull request in the browser."
      hitSlop={{ top: 8, bottom: 8 }}
      containerStyle={styles.container}
      style={styles.link}
    >
      <Icon
        name={pullRequestPaint(pullRequest).icon}
        size={14}
        colorValue={pullRequestIconColor(theme, pullRequest.state)}
      />
      <Text variant="caption1" weight="semibold" tone="tertiary" numberOfLines={1}>
        {pullRequestLabel(pullRequest)}
      </Text>
      <Icon name="external-link" size={12} color="tertiaryLabel" />
    </Touchable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { alignSelf: "flex-start" },
  link: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
  },
}));

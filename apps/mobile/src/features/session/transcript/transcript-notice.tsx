import type { AgentChatTranscriptNotice } from "@openducktor/frontend-core/sessions/send/agent-chat.types";
import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { monoWeight, sansWeight, touchSlop } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { useDisclosure } from "./rows/disclosure";
import { DisclosureMarker, Reveal } from "./rows/row-parts";

/** The desktop `h-8` outline action, a little taller for a finger. */
const ACTION_HEIGHT = 36;

/**
 * The desktop `AgentChatTranscriptNotice`: a card above the transcript with a loading spinner
 * or a warning icon, the title and description, "Show details", and an outline action such as
 * Retry.
 */
export const TranscriptNotice = memo(function TranscriptNotice({
  notice,
}: {
  notice: AgentChatTranscriptNotice;
}): ReactElement {
  const theme = useAppTheme();
  const { desktop } = theme;
  const loading = notice.severity === "loading";
  const details = useDisclosure(false, `${notice.kind}:${notice.title}`);
  const action = notice.action;
  const textColor = loading ? desktop.foreground : desktop.destructiveMuted;
  styles.useVariants({ loading });
  return (
    <View style={styles.holder}>
      <View style={styles.card} accessibilityRole={loading ? "progressbar" : "alert"}>
        <View style={styles.badge}>
          {loading ? (
            <LoaderSpinner size={16} color={desktop.mutedForeground} />
          ) : (
            <Icon name="triangle-alert" size={16} colorValue={desktop.destructiveMuted} />
          )}
        </View>
        <View style={styles.body}>
          <Text style={[styles.title, { color: textColor }]}>{notice.title}</Text>
          {notice.description.length > 0 ? (
            <Text
              selectable
              style={[
                styles.description,
                { color: loading ? desktop.mutedForeground : desktop.destructiveMuted },
              ]}
            >
              {notice.description}
            </Text>
          ) : null}
          {notice.details && notice.details.length > 0 ? (
            <View>
              <Touchable
                feedback="opacity"
                onPress={details.toggle}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Show details"
                accessibilityState={{ expanded: details.open }}
                style={styles.detailsToggle}
              >
                <DisclosureMarker
                  open={details.open}
                  animated={details.pressed}
                  color={textColor}
                />
                <Text style={[styles.title, { color: textColor }]}>Show details</Text>
              </Touchable>
              {details.open ? (
                <Reveal animate={details.pressed} style={styles.details}>
                  {notice.details.map((detail) => (
                    <View key={detail.label} style={styles.detail}>
                      <Text style={[styles.detailLabel, { color: textColor }]}>{detail.label}</Text>
                      <Text selectable style={[styles.detailValue, { color: textColor }]}>
                        {detail.value}
                      </Text>
                    </View>
                  ))}
                </Reveal>
              ) : null}
            </View>
          ) : null}
          {action ? (
            <Touchable
              feedback="scale"
              radius={theme.radius.md}
              onPress={action.onAction}
              disabled={action.disabled === true}
              hitSlop={touchSlop(ACTION_HEIGHT)}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              accessibilityState={{ busy: action.isPending === true }}
              style={styles.action}
            >
              {action.isPending ? (
                <LoaderSpinner size={14} color={desktop.destructiveMuted} />
              ) : (
                <Icon name="refresh-ccw" size={14} colorValue={desktop.destructiveMuted} />
              )}
              <Text style={styles.actionText}>{action.label}</Text>
            </Touchable>
          ) : null}
        </View>
      </View>
    </View>
  );
});

/**
 * The desktop empty transcript: a dashed card with a short text. The composer below is the next
 * action.
 */
export function EmptyTranscript(): ReactElement {
  return (
    <View style={styles.holder}>
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          No messages yet. Messages and agent activity show here.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  holder: {
    width: "100%",
    maxWidth: theme.layout.readableWidth + 2 * theme.layout.screenPadding,
    alignSelf: "center",
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.lg,
    paddingBottom: theme.space.xs,
  },
  // The desktop card: `flex items-start gap-3 rounded-xl border px-4 py-3 shadow-sm`.
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.space.md,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.md,
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
    boxShadow: theme.shadows.card,
    variants: {
      loading: {
        true: { borderColor: theme.desktop.border, backgroundColor: theme.desktop.card },
        false: {
          borderColor: theme.desktop.destructiveBorder,
          backgroundColor: theme.desktop.destructiveSurface,
        },
      },
    },
  },
  // The desktop `mt-0.5 rounded-full p-2`, on the muted color while it loads.
  badge: {
    marginTop: 2,
    padding: theme.space.sm,
    borderRadius: theme.radius.pill,
    variants: {
      loading: { true: { backgroundColor: theme.desktop.muted }, false: {} },
    },
  },
  body: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...sansWeight("medium"), fontSize: 14, lineHeight: 20 },
  description: { ...sansWeight("regular"), fontSize: 14, lineHeight: 20 },
  detailsToggle: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    marginTop: theme.space.sm,
  },
  details: { gap: theme.space.xs, marginTop: theme.space.sm },
  detail: { flexDirection: "row", gap: theme.space.sm },
  detailLabel: { ...sansWeight("medium"), fontSize: 12.5, lineHeight: 17 },
  detailValue: { ...monoWeight("regular"), flex: 1, fontSize: 12, lineHeight: 17 },
  // The desktop outline action: `h-8 border-destructive-border bg-card text-destructive-muted`.
  action: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    // Large text makes the action grow.
    minHeight: ACTION_HEIGHT,
    marginTop: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.xxs,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.destructiveBorder,
    backgroundColor: theme.desktop.card,
  },
  actionText: {
    ...sansWeight("medium"),
    fontSize: 13,
    lineHeight: 18,
    color: theme.desktop.destructiveMuted,
  },
  // The desktop empty state: `rounded-lg border border-dashed border-input bg-card p-4`.
  empty: {
    padding: theme.space.lg,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.desktop.input,
    backgroundColor: theme.desktop.card,
  },
  emptyText: {
    ...sansWeight("regular"),
    fontSize: 14,
    lineHeight: 20,
    color: theme.desktop.mutedForeground,
  },
}));

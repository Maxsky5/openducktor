import { PENDING_INPUT_LABELS } from "@openducktor/frontend-core/sessions/pending-input/pending-input-labels";
import {
  type ComponentRef,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
  type Ref,
  useState,
} from "react";
import { View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  ReduceMotion,
  useReducedMotion,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { motion, sansWeight } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";

export type RequestCardProps = PropsWithChildren<{
  kind: "permission" | "question";
  /** The one-line description under the title. */
  description: string | undefined;
  isSubagent: boolean;
  status: string;
  /** Rows under the body that stay when the body folds, such as a reply failure. */
  feedback?: ReactNode;
  cardRef?: Ref<ComponentRef<typeof View>> | undefined;
}>;

const CARD_ENTERING = FadeIn.duration(motion.base).reduceMotion(ReduceMotion.System);
const CARD_EXITING = FadeOut.duration(motion.fast).reduceMotion(ReduceMotion.System);
const CARD_LAYOUT = LinearTransition.duration(motion.base)
  .easing(motion.easeOutCurve)
  .reduceMotion(ReduceMotion.System);

/**
 * One pending request, as the desktop `AgentSessionQuestionCard` and `AgentSessionApprovalCard`
 * frames with `RequestCardHeader`. A question is a card with an input outline; a permission is an
 * amber card. The header folds the body away; the body starts open, because the request waits for
 * the user. The card fades out when the host confirms the reply.
 */
export function RequestCard({
  kind,
  description,
  isSubagent,
  status,
  feedback,
  cardRef,
  children,
}: RequestCardProps): ReactElement {
  const theme = useAppTheme();
  const reducedMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(true);
  const isPermission = kind === "permission";
  const title = isPermission
    ? PENDING_INPUT_LABELS.permissionTitle
    : PENDING_INPUT_LABELS.questionTitle;
  styles.useVariants({ kind });
  return (
    <Animated.View
      entering={CARD_ENTERING}
      exiting={CARD_EXITING}
      layout={CARD_LAYOUT}
      style={styles.card}
    >
      <View ref={cardRef} collapsable={false}>
        <Touchable
          feedback="highlight"
          radius={theme.radius.xl}
          onPress={() => setExpanded((current) => !current)}
          accessibilityRole="button"
          accessibilityLabel={[
            title,
            isSubagent ? PENDING_INPUT_LABELS.subagentRequest : null,
            status,
            description,
          ]
            .filter(Boolean)
            .join(", ")}
          accessibilityHint={expanded ? "Folds the request away." : "Shows the request."}
          accessibilityState={{ expanded }}
          style={styles.header}
        >
          <View style={styles.headerText}>
            <View style={styles.titleRow}>
              <Icon
                name={isPermission ? "shield-alert" : "circle-dot-dashed"}
                size={16}
                colorValue={
                  isPermission ? theme.desktop.warningMuted : theme.desktop.mutedForeground
                }
              />
              <Text style={styles.title}>{title}</Text>
              {isSubagent ? (
                <View style={styles.subagent}>
                  <Text style={styles.subagentText}>{PENDING_INPUT_LABELS.subagentRequest}</Text>
                </View>
              ) : null}
            </View>
            {description ? (
              <Text numberOfLines={1} style={styles.description}>
                {description}
              </Text>
            ) : null}
          </View>
          <Text tabular numberOfLines={1} style={styles.status}>
            {status}
          </Text>
          <Animated.View
            style={{
              transform: [{ rotate: expanded ? "0deg" : "-90deg" }],
              transitionProperty: "transform",
              transitionDuration: reducedMotion ? 0 : motion.fast,
              transitionTimingFunction: motion.easeOut,
            }}
          >
            <Icon name="chevron-down" size={16} colorValue={theme.desktop.foreground} />
          </Animated.View>
        </Touchable>
        {expanded ? <View style={styles.body}>{children}</View> : null}
        {feedback ? <View style={styles.feedback}>{feedback}</View> : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
    boxShadow: theme.shadows.card,
    variants: {
      kind: {
        question: { borderColor: theme.desktop.input, backgroundColor: theme.desktop.card },
        permission: {
          borderColor: theme.desktop.warningBorder,
          backgroundColor: theme.desktop.warningSurface,
        },
      },
    },
  },
  header: {
    minHeight: theme.touchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: 6,
  },
  headerText: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: theme.space.sm },
  title: {
    ...theme.type.subhead,
    ...sansWeight("semibold"),
    color: theme.desktop.foreground,
  },
  subagent: {
    paddingHorizontal: theme.space.sm,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    variants: {
      kind: {
        question: { borderColor: theme.desktop.input, backgroundColor: theme.desktop.muted },
        permission: {
          borderColor: theme.desktop.warningBorder,
          backgroundColor: theme.desktop.background,
        },
      },
    },
  },
  subagentText: {
    ...sansWeight("semibold"),
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: theme.desktop.mutedForeground,
  },
  description: { ...theme.type.footnote, color: theme.desktop.mutedForeground },
  status: {
    ...sansWeight("medium"),
    fontSize: 11,
    lineHeight: 14,
    variants: {
      kind: {
        question: { color: theme.desktop.foreground },
        permission: { color: theme.desktop.mutedForeground },
      },
    },
  },
  body: {
    gap: theme.space.sm,
    padding: 10,
    borderTopWidth: 1,
    variants: {
      kind: {
        question: { borderTopColor: theme.desktop.input },
        permission: { borderTopColor: theme.desktop.warningBorder },
      },
    },
  },
  feedback: { gap: theme.space.sm, paddingHorizontal: 10, paddingBottom: 10 },
}));

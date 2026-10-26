import { memo, type ReactElement } from "react";
import { View, type ViewStyle } from "react-native";
import Animated, { type CSSStyle, useReducedMotion } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { motion, touchSlop } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { useAnnounce } from "@/ui/use-announce";

/** The round desktop control. Its touch area grows to the platform touch target. */
const CONTROL_SIZE = 36;

/** Shows a floating control with a short slide from `offset`, and hides it with a fade. */
const appearStyle = (
  shown: boolean,
  reducedMotion: boolean,
  offset: number,
): CSSStyle<ViewStyle> => ({
  opacity: shown ? 1 : 0,
  transform: [{ translateY: shown || reducedMotion ? 0 : offset }],
  transitionProperty: ["opacity", "transform"],
  transitionDuration: motion.base,
  transitionTimingFunction: motion.easeOut,
});

/**
 * The desktop `ScrollToTopButton` at the top of the transcript: a round card button with an up
 * arrow. It shows while the reader is away from the first message.
 */
export const TranscriptTopButton = memo(function TranscriptTopButton({
  atTop,
  onJumpToTop,
}: {
  atTop: boolean;
  onJumpToTop: () => void;
}): ReactElement {
  const theme = useAppTheme();
  const reducedMotion = useReducedMotion();
  const shown = !atTop;
  styles.useVariants({ fresh: false });
  return (
    <View style={styles.topHolder} pointerEvents="box-none">
      <Animated.View
        style={appearStyle(shown, reducedMotion, -12)}
        pointerEvents={shown ? "auto" : "none"}
        accessibilityElementsHidden={!shown}
        importantForAccessibility={shown ? "auto" : "no-hide-descendants"}
      >
        <Touchable
          feedback="scale"
          onPress={onJumpToTop}
          radius={999}
          hitSlop={touchSlop(CONTROL_SIZE)}
          accessibilityRole="button"
          accessibilityLabel="Scroll to the first message"
          style={styles.button}
        >
          <Icon name="arrow-up" size={16} colorValue={theme.desktop.mutedForeground} />
        </Touchable>
      </Animated.View>
    </View>
  );
});

/**
 * The desktop `ScrollToBottomButton` at the bottom of the transcript: a round card button with a
 * down arrow. It rises in while the reader is away from the latest message. When content arrived
 * meanwhile, it turns into a violet "New activity" pill, so the reader knows that the agent moved
 * on.
 */
export const TranscriptLatestButton = memo(function TranscriptLatestButton({
  atBottom,
  hasNewActivity,
  onJumpToLatest,
}: {
  atBottom: boolean;
  hasNewActivity: boolean;
  onJumpToLatest: () => void;
}): ReactElement {
  const theme = useAppTheme();
  const reducedMotion = useReducedMotion();
  const shown = !atBottom;
  styles.useVariants({ fresh: hasNewActivity });
  useAnnounce(hasNewActivity ? "New activity" : null);
  return (
    <View style={styles.holder} pointerEvents="box-none">
      <Animated.View
        style={appearStyle(shown, reducedMotion, 12)}
        pointerEvents={shown ? "auto" : "none"}
        accessibilityElementsHidden={!shown}
        importantForAccessibility={shown ? "auto" : "no-hide-descendants"}
      >
        <Touchable
          feedback="scale"
          onPress={onJumpToLatest}
          radius={999}
          hitSlop={touchSlop(CONTROL_SIZE)}
          accessibilityRole="button"
          accessibilityLabel={
            hasNewActivity
              ? "New activity. Jump to the latest message"
              : "Jump to the latest message"
          }
          accessibilityLiveRegion={hasNewActivity ? "polite" : "none"}
          style={styles.button}
        >
          <Icon
            name="arrow-down"
            size={16}
            colorValue={hasNewActivity ? theme.colors.onTint : theme.desktop.mutedForeground}
          />
          {hasNewActivity ? (
            <Text variant="subhead" weight="semibold" tone="onTint">
              New activity
            </Text>
          ) : null}
        </Touchable>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  topHolder: {
    position: "absolute",
    left: 0,
    right: 0,
    top: theme.space.sm,
    alignItems: "center",
  },
  holder: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: theme.space.md,
    alignItems: "center",
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    // Large text makes the "New activity" pill grow.
    minHeight: CONTROL_SIZE,
    minWidth: CONTROL_SIZE,
    borderRadius: 999,
    borderWidth: 1,
    variants: {
      fresh: {
        true: {
          paddingHorizontal: 14,
          paddingVertical: theme.space.xxs,
          backgroundColor: theme.colors.tintFill,
          borderColor: theme.colors.tintFill,
          boxShadow: theme.shadows.primary,
        },
        false: {
          backgroundColor: theme.desktop.card,
          borderColor: theme.desktop.border,
          boxShadow: theme.shadows.raised,
        },
      },
    },
  },
}));

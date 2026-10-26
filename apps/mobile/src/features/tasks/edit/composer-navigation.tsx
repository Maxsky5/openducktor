import type {
  ComposerStep,
  EditTaskSection,
} from "@openducktor/frontend-core/tasks/create/task-composer-types";
import { Fragment, type ReactElement, useState } from "react";
import { View, type ViewStyle } from "react-native";
import Animated, { type CSSStyle } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { motion } from "@/theme/tokens";
import { haptics } from "@/ui/haptics";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";

const COMPOSER_STEPS = [
  { id: "type", title: "Type" },
  { id: "details", title: "Details" },
] as const satisfies readonly { id: ComposerStep; title: string }[];

type StepColors = {
  card: { background: string; border: string };
  badge: { background: string; border: string; text: string };
};

/**
 * The New Task stages as the desktop stepper on a narrow screen: a numbered card per stage, sky
 * for the current stage and emerald with a check for a finished one. A finished stage opens
 * again; a later stage does not.
 */
export function ComposerStepper({
  step,
  disabled,
  onStepChange,
}: {
  step: ComposerStep;
  disabled: boolean;
  onStepChange: (step: ComposerStep) => void;
}): ReactElement {
  const theme = useAppTheme();
  const d = theme.desktop;
  const activeIndex = COMPOSER_STEPS.findIndex((item) => item.id === step);
  return (
    <View style={styles.stepper} accessibilityRole="list" accessibilityLabel="Task creation stages">
      {COMPOSER_STEPS.map((item, index) => {
        const active = index === activeIndex;
        const complete = index < activeIndex;
        let card: StepColors["card"] = { background: d.card, border: d.border };
        let badge: StepColors["badge"] = {
          background: d.muted,
          border: d.input,
          text: d.mutedForeground,
        };
        if (active) {
          card = { background: d.infoSurface, border: d.infoBorder };
          badge = {
            background: d.infoSurface,
            border: d.infoBorder,
            text: d.infoSurfaceForeground,
          };
        } else if (complete) {
          card = { background: d.successSurface, border: d.successBorder };
          badge = {
            background: d.successSurface,
            border: d.successBorder,
            text: d.successSurfaceForeground,
          };
        }
        const state = active ? "current" : complete ? "done" : "next";
        return (
          <Fragment key={item.id}>
            {index > 0 ? (
              <Icon
                name="chevron-right"
                size={16}
                colorValue={
                  complete || active ? d.successAccent : withAlpha(d.mutedForeground, 0.4)
                }
              />
            ) : null}
            <Touchable
              feedback="scale"
              onPress={() => onStepChange(item.id)}
              disabled={disabled || !complete}
              dimWhenDisabled={false}
              radius={theme.radius.lg}
              containerStyle={styles.stepSlot}
              accessibilityRole="button"
              accessibilityLabel={`Stage ${index + 1}, ${item.title}, ${state}`}
              accessibilityState={{ selected: active }}
              style={[styles.step, { backgroundColor: card.background, borderColor: card.border }]}
            >
              <View
                style={[
                  styles.badge,
                  { backgroundColor: badge.background, borderColor: badge.border },
                ]}
              >
                {complete ? (
                  <Icon name="check" size={16} colorValue={badge.text} />
                ) : (
                  <Text variant="footnote" weight="semibold" tabular style={{ color: badge.text }}>
                    {index + 1}
                  </Text>
                )}
              </View>
              <Text variant="callout" weight="semibold">
                {item.title}
              </Text>
            </Touchable>
          </Fragment>
        );
      })}
    </View>
  );
}

const SECTION_ITEMS = [
  { id: "details", label: "Details", icon: "clipboard-list" },
  { id: "spec", label: "Spec", icon: "file-code" },
  { id: "plan", label: "Plan", icon: "scroll-text" },
] as const satisfies readonly { id: EditTaskSection; label: string; icon: IconName }[];

const thumbPosition = (width: number, index: number): CSSStyle<ViewStyle> => ({
  width,
  transform: [{ translateX: index * width }],
  transitionProperty: "transform",
  transitionDuration: motion.base,
  transitionTimingFunction: motion.easeOut,
});

/**
 * The Edit Task sections as the desktop section switcher: Details, Spec, and Plan with their
 * icons on a segmented control. A document with edits that are not saved shows "Unsaved".
 */
export function EditSectionSwitcher({
  section,
  unsavedSpec,
  unsavedPlan,
  disabled,
  onChange,
}: {
  section: EditTaskSection;
  unsavedSpec: boolean;
  unsavedPlan: boolean;
  disabled: boolean;
  onChange: (section: EditTaskSection) => void;
}): ReactElement {
  const theme = useAppTheme();
  const [width, setWidth] = useState(0);
  const index = Math.max(
    0,
    SECTION_ITEMS.findIndex((item) => item.id === section),
  );
  const segmentWidth = (width - 6) / SECTION_ITEMS.length;
  const unsaved = { details: false, spec: unsavedSpec, plan: unsavedPlan };
  return (
    <View
      style={[styles.segments, disabled && styles.segmentsDisabled]}
      accessibilityRole="radiogroup"
      accessibilityLabel="Edit section"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {width > 0 ? (
        <Animated.View style={[styles.thumb, thumbPosition(segmentWidth, index)]} />
      ) : null}
      {SECTION_ITEMS.map((item) => {
        const selected = item.id === section;
        // The white thumb of the segmented controls of the app.
        const color = selected ? theme.desktop.foreground : theme.desktop.mutedForeground;
        return (
          <Touchable
            key={item.id}
            feedback="opacity"
            onPress={() => {
              if (selected) return;
              haptics.selection();
              onChange(item.id);
            }}
            disabled={disabled}
            dimWhenDisabled={false}
            accessibilityRole="radio"
            accessibilityLabel={unsaved[item.id] ? `${item.label}, unsaved` : item.label}
            accessibilityState={{ checked: selected }}
            containerStyle={styles.segmentSlot}
            style={styles.segment}
          >
            <Icon name={item.icon} size={15} colorValue={color} />
            <Text
              variant="subhead"
              weight={selected ? "semibold" : "medium"}
              numberOfLines={1}
              style={{ color }}
            >
              {item.label}
            </Text>
            {unsaved[item.id] ? (
              <View style={styles.unsaved}>
                <Text variant="caption2" overline style={styles.unsavedText}>
                  Unsaved
                </Text>
              </View>
            ) : null}
          </Touchable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The two stages share the width of the form.
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.xs,
  },
  stepSlot: { flex: 1 },
  step: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderWidth: 1,
  },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  segments: {
    flexDirection: "row",
    padding: 2,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.muted,
  },
  segmentsDisabled: { opacity: 0.5 },
  thumb: {
    position: "absolute",
    top: 2,
    bottom: 2,
    left: 2,
    borderRadius: theme.radius.sm,
    borderCurve: "continuous",
    backgroundColor: theme.desktop.segmentedSelected,
    borderWidth: 1,
    borderColor: theme.desktop.input,
    boxShadow: theme.shadows.card,
  },
  segmentSlot: { flex: 1 },
  segment: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 4,
  },
  unsaved: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.desktop.warningSurface,
  },
  unsavedText: { fontSize: 9, lineHeight: 12, color: theme.desktop.warningMuted },
}));

import type { IssueType } from "@openducktor/contracts";
import {
  ISSUE_TYPE_CHOICES,
  issueTypeGuidance,
} from "@openducktor/frontend-core/tasks/create/task-composer-options";
import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import type { AppTheme } from "@/theme/tokens";
import { haptics } from "@/ui/haptics";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { ToolbarButton } from "./form-parts";

type IssueTypePaint = {
  icon: IconName;
  /** The card of the type in the type step. */
  card: { background: string; border: string };
  /** The icon tile. */
  tile: { background: string; foreground: string };
  /** The check circle of the selected card. */
  indicator: { background: string; border: string; foreground: string };
};

/** The desktop task composer colors and icons of each issue type. */
const issueTypePaint = (theme: AppTheme, issueType: IssueType): IssueTypePaint => {
  const d = theme.desktop;
  switch (issueType) {
    case "feature":
      return {
        icon: "sparkles",
        card: { background: d.infoSurface, border: d.infoBorder },
        tile: { background: d.infoSurface, foreground: d.infoMuted },
        indicator: { background: d.infoSurface, border: d.infoBorder, foreground: d.infoMuted },
      };
    case "bug":
      return {
        icon: "bug",
        card: { background: d.destructiveSurface, border: d.destructiveBorder },
        tile: { background: d.destructiveSurface, foreground: d.destructiveMuted },
        indicator: {
          background: d.destructiveSurface,
          border: d.destructiveBorder,
          foreground: d.destructiveMuted,
        },
      };
    case "task":
      return {
        icon: "list-todo",
        card: { background: withAlpha(d.muted, 0.8), border: d.input },
        tile: { background: d.secondary, foreground: d.foreground },
        indicator: { background: d.secondary, border: d.input, foreground: d.foreground },
      };
    case "epic":
      return {
        icon: "layers",
        card: { background: d.pendingSurface, border: d.pendingBorder },
        tile: { background: d.pendingSurface, foreground: d.pendingMuted },
        indicator: {
          background: d.pendingSurface,
          border: d.pendingBorder,
          foreground: d.pendingMuted,
        },
      };
  }
};

/** The 36-point icon tile of an issue type, as the desktop composer. */
function IssueTypeIconTile({ issueType }: { issueType: IssueType }): ReactElement {
  const theme = useAppTheme();
  const paint = issueTypePaint(theme, issueType);
  return (
    <View style={[styles.tile, { backgroundColor: paint.tile.background }]}>
      <Icon name={paint.icon} size={17} colorValue={paint.tile.foreground} />
    </View>
  );
}

/**
 * The type step of New Task, as the desktop issue type grid: one card per type in its color, with
 * the icon, the name, the description, and a check circle. A type that cannot be created yet
 * stays visible and dimmed with its reason.
 */
export const IssueTypeGrid = memo(function IssueTypeGrid({
  selected,
  disabled,
  onSelect,
}: {
  selected: IssueType | null;
  disabled: boolean;
  onSelect: (issueType: IssueType) => void;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="Issue type">
      {ISSUE_TYPE_CHOICES.map((choice) => {
        const isSelected = selected === choice.value;
        const unavailable = choice.disabled === true && !isSelected;
        const paint = issueTypePaint(theme, choice.value);
        const description =
          unavailable && choice.disabledText ? choice.disabledText : choice.description;
        return (
          <Touchable
            key={choice.value}
            feedback="scale"
            onPress={() => {
              haptics.selection();
              onSelect(choice.value);
            }}
            disabled={disabled || unavailable}
            radius={theme.radius.xl}
            accessibilityRole="radio"
            accessibilityLabel={`${choice.label}. ${description}`}
            accessibilityState={{ checked: isSelected }}
            style={[
              styles.card,
              { backgroundColor: paint.card.background, borderColor: paint.card.border },
            ]}
          >
            <View style={styles.cardTop}>
              <IssueTypeIconTile issueType={choice.value} />
              {unavailable ? null : (
                <View
                  style={[
                    styles.indicator,
                    isSelected
                      ? {
                          backgroundColor: paint.indicator.background,
                          borderColor: paint.indicator.border,
                        }
                      : styles.indicatorEmpty,
                  ]}
                >
                  {isSelected ? (
                    <Icon name="check" size={14} colorValue={paint.indicator.foreground} />
                  ) : null}
                </View>
              )}
            </View>
            <View style={styles.cardText}>
              <Text variant="title3">{choice.label}</Text>
              <Text variant="callout" tone="tertiary">
                {description}
              </Text>
            </View>
          </Touchable>
        );
      })}
    </View>
  );
});

/**
 * The chosen issue type at the top of the details step, as the desktop details form: the icon
 * tile, the name, and Change in New Task on one row, then the type guidance.
 */
export function IssueTypeSummary({
  issueType,
  onChange,
  disabled,
}: {
  issueType: IssueType;
  /** Goes back to the type step. Null in Edit Task, where the type cannot change. */
  onChange: (() => void) | null;
  disabled: boolean;
}): ReactElement {
  const label = ISSUE_TYPE_CHOICES.find((choice) => choice.value === issueType)?.label ?? issueType;
  return (
    <View
      style={styles.summary}
      accessible={onChange === null}
      accessibilityLabel={`Issue type ${label}. ${issueTypeGuidance(issueType)}`}
    >
      <View style={styles.summaryHeader}>
        <IssueTypeIconTile issueType={issueType} />
        <Text variant="callout" weight="semibold" style={styles.summaryName}>
          {label}
        </Text>
        {onChange ? (
          <ToolbarButton
            label="Change"
            variant="outline"
            disabled={disabled}
            accessibilityLabel={`Change the issue type, now ${label}`}
            onPress={onChange}
          />
        ) : null}
      </View>
      <Text variant="footnote" tone="tertiary">
        {issueTypeGuidance(issueType)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  grid: { gap: theme.space.md },
  card: {
    gap: theme.space.md,
    padding: theme.space.lg,
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
  },
  cardTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  cardText: { gap: theme.space.xs },
  tile: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
  },
  indicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  indicatorEmpty: { borderColor: theme.desktop.input, backgroundColor: theme.desktop.card },
  // The icon, the name, and Change share one centered row, and the guidance spans the card.
  summary: {
    gap: theme.space.sm,
    padding: theme.space.md,
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
  },
  summaryHeader: { flexDirection: "row", alignItems: "center", gap: theme.space.md },
  summaryName: { flex: 1 },
}));

import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { findCatalogModel } from "@openducktor/frontend-core/lib/model-catalog-selection";
import {
  buildContextUsagePresentation,
  type ContextUsagePresentation,
  type ContextUsageSeverity,
} from "@openducktor/frontend-core/sessions/composer/context-usage/context-usage-presentation";
import { useSelectedSessionContextUsage } from "@openducktor/frontend-core/sessions/composer/context-usage/use-selected-session-context-usage";
import type { AgentSessionContextUsage } from "@openducktor/frontend-core/types/agent-orchestrator";
import { memo, type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { View, type ViewStyle } from "react-native";
import Animated, { type CSSStyle, useReducedMotion } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import type { AppTheme } from "@/theme/tokens";
import { motion, touchSlop } from "@/theme/tokens";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";

/** Session Context Usage from the shared hook that the desktop composer uses, ready to show. */
export function useContextUsage({
  contextUsage,
  catalog,
  selectedModel,
}: {
  contextUsage: AgentSessionContextUsage | null;
  catalog: AgentModelCatalog | null;
  selectedModel: AgentModelSelection | null;
}): ContextUsagePresentation | null {
  const selectedModelEntry = useMemo(
    () => (catalog && selectedModel ? findCatalogModel(catalog, selectedModel) : null),
    [catalog, selectedModel],
  );
  const latest = useSelectedSessionContextUsage({ contextUsage, catalog, selectedModelEntry });
  return useMemo(() => (latest ? buildContextUsagePresentation(latest) : null), [latest]);
}

/** The desktop usage colors: success, then warning from 75%, then destructive from 90%. */
const severityAccent = (theme: AppTheme, severity: ContextUsageSeverity): string => {
  switch (severity) {
    case "critical":
      return theme.desktop.destructiveAccent;
    case "warning":
      return theme.desktop.warningAccent;
    case "normal":
      return theme.desktop.successAccent;
  }
};

const RING_SIZE = 16;
const RING_RADIUS = 6;
const RING_STROKE = 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
/** The details hide by themselves after a while, as a tooltip. */
const DETAILS_MS = 5000;

const TOOLTIP_IN: CSSStyle<ViewStyle> = {
  animationName: {
    from: { opacity: 0, transform: [{ scale: 0.98 }] },
    to: { opacity: 1, transform: [{ scale: 1 }] },
  },
  animationDuration: 150,
  animationTimingFunction: motion.easeOut,
};

const TOOLTIP_IN_REDUCED: CSSStyle<ViewStyle> = {
  animationName: { from: { opacity: 0 }, to: { opacity: 1 } },
  animationDuration: 150,
  animationTimingFunction: motion.easeOut,
};

/**
 * The context indicator: a 16-point ring of the used share in the color of the usage level. The
 * desktop also shows the compact token count; on a phone the model selector needs that width. A
 * press shows the desktop tooltip above it: the share as a bar and the exact token counts.
 */
export const ContextUsageIndicator = memo(function ContextUsageIndicator({
  usage,
}: {
  usage: ContextUsagePresentation;
}): ReactElement {
  const theme = useAppTheme();
  const reducedMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((current) => !current), []);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setOpen(false), DETAILS_MS);
    return () => clearTimeout(timer);
  }, [open]);
  const accent = severityAccent(theme, usage.severity);
  return (
    <View>
      {open ? (
        <Animated.View
          style={[styles.tooltip, reducedMotion ? TOOLTIP_IN_REDUCED : TOOLTIP_IN]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text variant="caption2" style={styles.tooltipTitle}>
            Session Context
          </Text>
          <View style={styles.meterLine}>
            <View style={styles.meter}>
              <View
                style={[
                  styles.meterFill,
                  { width: `${usage.meterPercent}%`, backgroundColor: accent },
                ]}
              />
            </View>
            <Text variant="caption2" tabular style={styles.tooltipStrong}>
              {usage.usageLabel}
            </Text>
          </View>
          <Text variant="caption2" style={styles.tooltipText}>
            {`Used: ${usage.exactTotal} tokens`}
          </Text>
          <Text variant="caption2" style={styles.tooltipText}>
            {`Max context: ${usage.exactWindow} tokens`}
          </Text>
          {usage.exactOutput ? (
            <Text variant="caption2" style={styles.tooltipText}>
              {`Output limit: ${usage.exactOutput} tokens`}
            </Text>
          ) : null}
        </Animated.View>
      ) : null}
      <Touchable
        feedback="opacity"
        onPress={toggle}
        hitSlop={touchSlop(28)}
        accessibilityRole="button"
        accessibilityLabel={usage.accessibleLabel}
        accessibilityHint={open ? "Hides the token counts." : "Shows the token counts."}
        accessibilityState={{ expanded: open }}
        style={styles.trigger}
      >
        <Svg width={RING_SIZE} height={RING_SIZE} viewBox="0 0 16 16">
          <Circle
            cx={8}
            cy={8}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_STROKE}
            stroke={withAlpha(theme.desktop.foreground, 0.15)}
          />
          <Circle
            cx={8}
            cy={8}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            stroke={accent}
            strokeDasharray={`${RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
            strokeDashoffset={RING_CIRCUMFERENCE * (1 - usage.meterPercent / 100)}
            transform="rotate(-90 8 8)"
          />
        </Svg>
      </Touchable>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  // The desktop trigger: `h-7 rounded-lg px-1.5`, a 28-point square around the ring.
  trigger: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 28,
    paddingHorizontal: 6,
    borderRadius: theme.radius.lg,
  },
  // The desktop tooltip: `bg-foreground text-background rounded-md w-64 p-2 text-[11px]`.
  tooltip: {
    position: "absolute",
    right: 0,
    bottom: 34,
    width: 256,
    padding: theme.space.sm,
    gap: 2,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    backgroundColor: theme.desktop.foreground,
    transformOrigin: "bottom right",
  },
  tooltipTitle: { fontSize: 11, lineHeight: 15, color: theme.desktop.background },
  tooltipStrong: {
    fontFamily: theme.fonts.sans.medium,
    fontWeight: "500",
    fontSize: 11,
    lineHeight: 15,
    color: theme.desktop.background,
  },
  tooltipText: {
    fontFamily: theme.fonts.sans.regular,
    fontWeight: "400",
    fontSize: 11,
    lineHeight: 15,
    color: theme.desktop.background,
  },
  meterLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    marginTop: 4,
    marginBottom: 4,
  },
  meter: {
    flex: 1,
    height: 6,
    overflow: "hidden",
    borderRadius: theme.radius.pill,
    backgroundColor: withAlpha(theme.desktop.background, 0.25),
  },
  meterFill: { height: "100%" },
}));

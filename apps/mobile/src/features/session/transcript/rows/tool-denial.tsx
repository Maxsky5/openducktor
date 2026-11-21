import type { AgentToolDenial } from "@openducktor/contracts";
import {
  readToolDenialPresentation,
  TOOL_DENIAL_ALLOW_HINT,
  TOOL_DENIAL_ALLOWED_MESSAGE,
  type ToolDenialRiskTone,
} from "@openducktor/frontend-core/sessions/messages/tool-denial";
import { useDeniedToolAction } from "@openducktor/frontend-core/sessions/messages/use-denied-tool-action";
import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { withAlpha } from "@/theme/color-alpha";
import { useAppTheme } from "@/theme/app-theme-context";
import { sansWeight } from "@/theme/tokens";
import { Button } from "@/ui/button";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { ToolPartSessionProvider } from "./tool-details";

const RISK_STYLES = {
  neutral: { box: "riskNeutral", text: "riskNeutralText" },
  warning: { box: "riskWarning", text: "riskWarningText" },
  danger: { box: "riskDanger", text: "riskDangerText" },
} as const satisfies Record<ToolDenialRiskTone, { box: string; text: string }>;

/**
 * The desktop `ToolDenialNotice`: why a policy blocked the call, under its tool line, with an
 * Allow footer while the user can allow the call. The reason wraps, so all of it shows.
 */
export function ToolDenialNotice({
  callId,
  denial,
}: {
  callId: string;
  denial: AgentToolDenial;
}): ReactElement {
  const { desktop } = useAppTheme();
  const { label, reason, risk } = readToolDenialPresentation(denial);
  const riskStyles = risk ? RISK_STYLES[risk.tone] : null;
  return (
    <View accessibilityRole="summary" accessibilityLabel={label} style={styles.card}>
      <View style={styles.body}>
        <View style={styles.iconTile}>
          <Icon name="shield-alert" size={14} colorValue={desktop.warningAccent} />
        </View>
        <View style={styles.text}>
          <View style={styles.heading}>
            <Text style={styles.label}>{label}</Text>
            {risk && riskStyles ? (
              <View style={[styles.risk, styles[riskStyles.box]]}>
                <Text style={[styles.riskText, styles[riskStyles.text]]}>{risk.label}</Text>
              </View>
            ) : null}
          </View>
          {reason ? (
            <Text selectable style={styles.reason}>
              {reason}
            </Text>
          ) : null}
        </View>
      </View>
      <ToolPartSessionProvider>
        <DeniedToolActionFooter callId={callId} />
      </ToolPartSessionProvider>
    </View>
  );
}

/** The Allow button and its note, its progress, or the note that the user allowed the call. */
function DeniedToolActionFooter({ callId }: { callId: string }): ReactElement | null {
  const { desktop } = useAppTheme();
  const action = useDeniedToolAction(callId);
  if (!action) return null;
  const failure = action.failure ? (
    <Text accessibilityRole="alert" style={styles.failure}>
      {action.failure}
    </Text>
  ) : null;
  if (action.state === "allowed") {
    return (
      <View style={[styles.footer, styles.allowedFooter]}>
        <View style={styles.allowedLine}>
          <Icon name="check" size={14} colorValue={desktop.successMuted} />
          <Text style={styles.allowed}>{TOOL_DENIAL_ALLOWED_MESSAGE}</Text>
        </View>
        {failure}
      </View>
    );
  }
  return (
    <View style={styles.footer}>
      <View style={styles.actionLine}>
        <Text style={styles.hint}>{TOOL_DENIAL_ALLOW_HINT}</Text>
        <Button
          label={action.isSending ? "Allowing" : "Allow"}
          size="sm"
          command
          loading={action.isSending}
          accessibilityHint={TOOL_DENIAL_ALLOW_HINT}
          onPress={action.allow}
        />
      </View>
      {failure}
    </View>
  );
}

const SMALL_TEXT = { fontSize: 12, lineHeight: 18 } as const;

const styles = StyleSheet.create((theme) => ({
  // The desktop `ml-[22px] rounded-lg border border-border bg-card`.
  card: {
    marginLeft: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
  },
  body: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  iconTile: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: theme.radius.xs,
    borderColor: theme.desktop.warningBorder,
    backgroundColor: theme.desktop.warningSurface,
  },
  text: { flex: 1, minWidth: 0, gap: 2 },
  heading: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: 8,
    rowGap: 4,
  },
  label: {
    ...sansWeight("medium"),
    fontSize: 13,
    lineHeight: 24,
    color: theme.desktop.foreground,
  },
  risk: {
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 8,
  },
  riskText: { ...sansWeight("medium"), fontSize: 11, lineHeight: 18 },
  riskNeutral: { borderColor: theme.desktop.border, backgroundColor: theme.desktop.muted },
  riskNeutralText: { color: theme.desktop.mutedForeground },
  riskWarning: {
    borderColor: theme.desktop.warningBorder,
    backgroundColor: theme.desktop.warningSurface,
  },
  riskWarningText: { color: theme.desktop.warningMuted },
  riskDanger: {
    borderColor: theme.desktop.destructiveBorder,
    backgroundColor: theme.desktop.destructiveSurface,
  },
  riskDangerText: { color: theme.desktop.destructiveMuted },
  reason: { ...sansWeight("regular"), ...SMALL_TEXT, color: theme.desktop.mutedForeground },
  // The desktop `border-t border-border bg-muted/40 px-3 py-2`.
  footer: {
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: theme.desktop.border,
    backgroundColor: withAlpha(theme.desktop.muted, 0.4),
    paddingHorizontal: 12,
    paddingVertical: theme.space.sm,
  },
  actionLine: { flexDirection: "row", alignItems: "center", gap: 12 },
  hint: { ...sansWeight("regular"), ...SMALL_TEXT, flex: 1, color: theme.desktop.mutedForeground },
  allowedFooter: {
    borderTopColor: theme.desktop.successBorder,
    backgroundColor: theme.desktop.successSurface,
  },
  allowedLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  allowed: {
    ...sansWeight("regular"),
    ...SMALL_TEXT,
    flexShrink: 1,
    color: theme.desktop.successMuted,
  },
  failure: { ...sansWeight("regular"), ...SMALL_TEXT, color: theme.desktop.destructiveMuted },
}));

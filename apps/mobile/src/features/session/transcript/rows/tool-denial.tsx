import type { AgentToolDenial } from "@openducktor/contracts";
import {
  readToolDenialPresentation,
  TOOL_DENIAL_ALLOW_HINT,
  TOOL_DENIAL_ALLOW_LABEL,
  TOOL_DENIAL_ALLOWED_DETAIL,
  TOOL_DENIAL_ALLOWED_LABEL,
  TOOL_DENIAL_ALLOWING_LABEL,
  type ToolDenialRiskTone,
} from "@openducktor/frontend-core/sessions/messages/tool-denial";
import {
  type DeniedToolAction,
  useDeniedToolAction,
} from "@openducktor/frontend-core/sessions/messages/use-denied-tool-action";
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
 * Allow button while the user can allow the call. The reason wraps, so all of it shows.
 */
export function ToolDenialNotice({
  callId,
  denial,
}: {
  callId: string;
  denial: AgentToolDenial;
}): ReactElement {
  return (
    <ToolPartSessionProvider>
      <ToolDenialCard callId={callId} denial={denial} />
    </ToolPartSessionProvider>
  );
}

function ToolDenialCard({
  callId,
  denial,
}: {
  callId: string;
  denial: AgentToolDenial;
}): ReactElement {
  const { desktop } = useAppTheme();
  const { label, category, reason, risk } = readToolDenialPresentation(denial);
  const action = useDeniedToolAction(callId);
  const detail = category ?? reason;
  return (
    <View accessibilityRole="summary" accessibilityLabel={label} style={styles.card}>
      <View style={styles.heading}>
        <Icon name="shield-alert" size={14} colorValue={desktop.warningAccent} />
        <Text style={styles.label}>{label}</Text>
        {risk ? (
          <View style={[styles.risk, styles[RISK_STYLES[risk.tone].box]]}>
            <Text style={[styles.riskText, styles[RISK_STYLES[risk.tone].text]]}>{risk.label}</Text>
          </View>
        ) : null}
      </View>
      {/* The text and the action start under the label: the 14 point icon and the 8 point gap. */}
      <View style={styles.body}>
        {detail ? (
          <Text selectable textBreakStrategy="balanced" style={styles.detail}>
            {detail}
          </Text>
        ) : null}
        {action ? <DeniedToolActionRow action={action} /> : null}
      </View>
    </View>
  );
}

/** The Allow button and what it does, its progress, or the note that the user allowed the call. */
function DeniedToolActionRow({ action }: { action: DeniedToolAction }): ReactElement {
  const { desktop } = useAppTheme();
  const failure = action.failure ? (
    <Text accessibilityRole="alert" style={styles.failure}>
      {action.failure}
    </Text>
  ) : null;
  if (action.state === "allowed") {
    return (
      <View style={styles.actionBlock}>
        <View style={styles.allowed}>
          <View style={styles.allowedIcon}>
            <Icon name="check" size={14} colorValue={desktop.successMuted} />
          </View>
          {/* One line for each sentence: a narrow screen would break the second one. */}
          <View style={styles.allowedLines}>
            <Text style={styles.allowedLabel}>{TOOL_DENIAL_ALLOWED_LABEL}</Text>
            <Text style={styles.allowedText}>{TOOL_DENIAL_ALLOWED_DETAIL}</Text>
          </View>
        </View>
        {failure}
      </View>
    );
  }
  return (
    <View style={styles.actionBlock}>
      <View style={styles.actionRow}>
        {/* The hint is for screen readers: a note under the button would make the card too tall. */}
        <Button
          label={action.isSending ? TOOL_DENIAL_ALLOWING_LABEL : TOOL_DENIAL_ALLOW_LABEL}
          variant="warning"
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

// The tool line above uses 13 points.
const LABEL_TEXT = { fontSize: 13, lineHeight: 18 } as const;
const SMALL_TEXT = { fontSize: 13, lineHeight: 19 } as const;

const styles = StyleSheet.create((theme) => ({
  // The desktop `ml-[22px] rounded-lg border border-warning-border/50 bg-card px-3.5 py-3`. The
  // card starts under the tool name: the row inset, the 14 point icon, and the 8 point gap.
  card: {
    marginLeft: theme.space.xs + 14 + 8,
    marginRight: theme.space.xs,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    borderColor: withAlpha(theme.desktop.warningBorder, 0.5),
    backgroundColor: theme.desktop.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  heading: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { ...sansWeight("medium"), ...LABEL_TEXT, flexShrink: 1, color: theme.desktop.foreground },
  risk: { borderWidth: 1, borderRadius: theme.radius.pill, paddingHorizontal: 8 },
  riskText: { ...sansWeight("medium"), fontSize: 11, lineHeight: 16 },
  riskNeutral: { borderColor: theme.desktop.border },
  riskNeutralText: { color: theme.desktop.mutedForeground },
  riskWarning: { borderColor: theme.desktop.warningBorder },
  riskWarningText: { color: theme.desktop.warningMuted },
  riskDanger: { borderColor: theme.desktop.destructiveBorder },
  riskDangerText: { color: theme.desktop.destructiveMuted },
  body: { paddingLeft: 22 },
  detail: {
    ...sansWeight("regular"),
    ...SMALL_TEXT,
    marginTop: 4,
    color: theme.desktop.mutedForeground,
  },
  actionBlock: { marginTop: 12, gap: 6 },
  actionRow: { flexDirection: "row" },
  failure: { ...sansWeight("regular"), ...SMALL_TEXT, color: theme.desktop.destructiveMuted },
  // The check sits in the shield column, so the text starts under the label.
  allowed: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginLeft: -22 },
  // Centers the icon on the first line when the text wraps.
  allowedIcon: { height: SMALL_TEXT.lineHeight, justifyContent: "center" },
  allowedText: {
    ...sansWeight("regular"),
    ...SMALL_TEXT,
    flexShrink: 1,
    color: theme.desktop.mutedForeground,
  },
  allowedLines: { flexShrink: 1 },
  allowedLabel: { ...sansWeight("regular"), ...SMALL_TEXT, color: theme.desktop.successMuted },
}));

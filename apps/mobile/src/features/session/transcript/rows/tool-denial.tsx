import type { AgentToolDenial } from "@openducktor/contracts";
import {
  readToolDenialPresentation,
  TOOL_DENIAL_ALLOW_HINT,
  TOOL_DENIAL_ALLOWED_LABEL,
  TOOL_DENIAL_ALLOWED_MESSAGE,
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
        {action ? (
          <View style={styles.action}>
            <DeniedToolActionControl action={action} />
          </View>
        ) : null}
      </View>
      {detail ? (
        <Text selectable textBreakStrategy="balanced" style={styles.detail}>
          {detail}
        </Text>
      ) : null}
      {action?.failure ? (
        <Text accessibilityRole="alert" style={[styles.detail, styles.failure]}>
          {action.failure}
        </Text>
      ) : null}
    </View>
  );
}

/** The Allow button and its progress, or the label that says the user allowed the call. */
function DeniedToolActionControl({ action }: { action: DeniedToolAction }): ReactElement {
  const { desktop } = useAppTheme();
  if (action.state === "allowed") {
    return (
      <View accessible accessibilityLabel={TOOL_DENIAL_ALLOWED_MESSAGE} style={styles.allowed}>
        <Icon name="check" size={14} colorValue={desktop.successMuted} />
        <Text style={styles.allowedText}>{TOOL_DENIAL_ALLOWED_LABEL}</Text>
      </View>
    );
  }
  return (
    <Button
      label={action.isSending ? "Allowing" : "Allow"}
      variant="outline"
      size="sm"
      command
      loading={action.isSending}
      accessibilityHint={TOOL_DENIAL_ALLOW_HINT}
      onPress={action.allow}
    />
  );
}

// The tool line above uses 13 points.
const LABEL_TEXT = { fontSize: 13, lineHeight: 18 } as const;
const SMALL_TEXT = { fontSize: 13, lineHeight: 19 } as const;

const styles = StyleSheet.create((theme) => ({
  // The desktop `ml-[22px] rounded-lg border border-warning-border/50 bg-card px-3 py-2`. The
  // card starts under the tool name: the row inset, the 14 point icon, and the 8 point gap.
  card: {
    marginLeft: theme.space.xs + 14 + 8,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    borderColor: withAlpha(theme.desktop.warningBorder, 0.5),
    backgroundColor: theme.desktop.card,
    marginRight: theme.space.xs,
    // The Allow button gets the same space above it and on its right.
    paddingLeft: 12,
    paddingRight: 10,
    paddingVertical: 10,
  },
  // As tall as the Allow button, so cards with and without it share one rhythm.
  heading: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32 },
  label: { ...sansWeight("medium"), ...LABEL_TEXT, flexShrink: 1, color: theme.desktop.foreground },
  risk: { borderWidth: 1, borderRadius: theme.radius.pill, paddingHorizontal: 8 },
  riskText: { ...sansWeight("medium"), fontSize: 11, lineHeight: 16 },
  riskNeutral: { borderColor: theme.desktop.border },
  riskNeutralText: { color: theme.desktop.mutedForeground },
  riskWarning: { borderColor: theme.desktop.warningBorder },
  riskWarningText: { color: theme.desktop.warningMuted },
  riskDanger: { borderColor: theme.desktop.destructiveBorder },
  riskDangerText: { color: theme.desktop.destructiveMuted },
  action: { marginLeft: "auto", paddingLeft: 8 },
  // The text starts under the label: the 14 point icon and the 8 point gap.
  detail: {
    ...sansWeight("regular"),
    ...SMALL_TEXT,
    paddingLeft: 22,
    color: theme.desktop.mutedForeground,
  },
  failure: { marginTop: 4, color: theme.desktop.destructiveMuted },
  allowed: { height: 32, flexDirection: "row", alignItems: "center", gap: 4 },
  allowedText: { ...sansWeight("medium"), ...SMALL_TEXT, color: theme.desktop.successMuted },
}));

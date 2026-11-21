import type { AgentToolDenial } from "@openducktor/contracts";
import {
  readToolDenialPresentation,
  TOOL_DENIAL_ALLOWED_MESSAGE,
} from "@openducktor/frontend-core/sessions/messages/tool-denial";
import { useDeniedToolAction } from "@openducktor/frontend-core/sessions/messages/use-denied-tool-action";
import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { sansWeight } from "@/theme/tokens";
import { Button } from "@/ui/button";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { ToolPartSessionProvider } from "./tool-details";

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
  const { desktop } = useAppTheme();
  const { label, reason, riskLabel } = readToolDenialPresentation(denial);
  return (
    <View style={styles.box}>
      <View style={styles.heading}>
        <Icon name="shield-alert" size={14} colorValue={desktop.warningAccent} />
        <Text style={styles.label}>{label}</Text>
        {riskLabel ? (
          <View style={styles.risk}>
            <Text style={styles.riskText}>{riskLabel}</Text>
          </View>
        ) : null}
      </View>
      {reason ? (
        <Text selectable style={styles.reason}>
          {reason}
        </Text>
      ) : null}
      <ToolPartSessionProvider>
        <DeniedToolActionControl callId={callId} />
      </ToolPartSessionProvider>
    </View>
  );
}

/** The Allow button, its progress, or the note that the user allowed the call. */
function DeniedToolActionControl({ callId }: { callId: string }): ReactElement | null {
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
      <>
        <View style={styles.heading}>
          <Icon name="check" size={14} colorValue={desktop.successMuted} />
          <Text style={styles.allowed}>{TOOL_DENIAL_ALLOWED_MESSAGE}</Text>
        </View>
        {failure}
      </>
    );
  }
  return (
    <>
      <Button
        label="Allow"
        variant="outline"
        size="sm"
        command
        loading={action.isSending}
        accessibilityHint="Lets the agent try this call again."
        onPress={action.allow}
      />
      {failure}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The desktop `ml-[22px] rounded-md border border-warning-border bg-warning-surface px-2.5 py-2`.
  box: {
    marginLeft: 22,
    gap: 6,
    borderWidth: 1,
    borderRadius: theme.radius.xs,
    borderColor: theme.desktop.warningBorder,
    backgroundColor: theme.desktop.warningSurface,
    paddingHorizontal: 10,
    paddingVertical: theme.space.sm,
  },
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.space.sm },
  label: {
    ...sansWeight("medium"),
    fontSize: 12,
    lineHeight: 16,
    color: theme.desktop.warningMuted,
  },
  risk: {
    borderWidth: 1,
    borderRadius: 4,
    borderColor: theme.desktop.warningBorder,
    paddingHorizontal: theme.space.xs,
  },
  riskText: {
    ...sansWeight("medium"),
    fontSize: 11,
    lineHeight: 16,
    color: theme.desktop.warningMuted,
  },
  reason: {
    ...sansWeight("regular"),
    fontSize: 12,
    lineHeight: 18,
    color: theme.desktop.warningSurfaceForeground,
  },
  allowed: {
    ...sansWeight("regular"),
    fontSize: 12,
    lineHeight: 18,
    flexShrink: 1,
    color: theme.desktop.successMuted,
  },
  failure: {
    ...sansWeight("regular"),
    fontSize: 12,
    lineHeight: 18,
    color: theme.desktop.destructiveMuted,
  },
}));

import { terminalTabLabel } from "@openducktor/frontend-core/terminals/terminal-presentation-state";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { type ReactElement, useCallback, useMemo } from "react";
import { ActivityIndicator, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { WorkHeaderTitle } from "@/features/work-owner/work-header-title";
import type { WorkOwner } from "@/features/work-owner/work-owner-context";
import { WorkOwnerScreen } from "@/features/work-owner/work-owner-screen";
import { useAppTheme } from "@/theme/app-theme-context";
import { IconButton } from "@/ui/icon-button";
import { EmptyState } from "@/ui/states";
import { findTerminalTab } from "./terminal-list-model";
import { TerminalNoticeStrip, TerminalTransportNotice } from "./terminal-notice-strip";
import { TerminalPane } from "./terminal-pane";
import { TerminalRestartButton } from "./terminal-restart-button";
import { useOwnerTerminals } from "./use-owner-terminals";
import { useTerminalClose } from "./use-terminal-close";

/** One terminal of a task or chat, attached and ready for input. */
export function TerminalScreen(): ReactElement {
  const { terminalId } = useLocalSearchParams();
  const id = Array.isArray(terminalId) ? terminalId[0] : terminalId;
  return (
    <WorkOwnerScreen title="Terminal" diffs={false}>
      {(owner) =>
        id ? (
          <TerminalContent owner={owner} terminalId={id} />
        ) : (
          <EmptyState
            icon="link-off"
            title="Incomplete Link"
            message="It does not name a terminal. Open the terminal again from Terminals."
          />
        )
      }
    </WorkOwnerScreen>
  );
}

function TerminalContent({
  owner,
  terminalId,
}: {
  owner: WorkOwner;
  terminalId: string;
}): ReactElement {
  const router = useRouter();
  const theme = useAppTheme();
  const model = useOwnerTerminals(owner);
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);
  const { close, closeUnknown } = useTerminalClose(model, goBack);
  const tab = findTerminalTab(model.tabs, terminalId);
  const closing = tab !== null && model.closingTabIds.has(tab.tabId);
  // The close control of the desktop terminal tab. It turns into a spinner while the host closes.
  const { controller } = model;
  const headerRight = useCallback(() => {
    if (tab?.requestState !== "ready") return null;
    const label = terminalTabLabel(tab);
    const closeControl = closing ? (
      <View
        style={styles.closing}
        accessibilityRole="progressbar"
        accessibilityLabel={`Closing ${label}`}
      >
        <ActivityIndicator size="small" color={theme.desktop.mutedForeground} />
      </View>
    ) : (
      <IconButton
        icon="x"
        command
        accessibilityLabel={`Close ${label}`}
        onPress={() => void close(tab)}
      />
    );
    return (
      <View style={styles.actions}>
        {controller && !closing ? (
          <TerminalRestartButton summary={tab.summary} controller={controller} />
        ) : null}
        {closeControl}
      </View>
    );
  }, [close, closing, controller, tab, theme.desktop.mutedForeground]);
  const options = useMemo(() => {
    const label = tab ? terminalTabLabel(tab) : "Terminal";
    // A terminal label is often its working directory: the title shows the folder name.
    const name = label.split("/").findLast((part) => part.length > 0) ?? label;
    return {
      title: label,
      headerTitle: () => <WorkHeaderTitle title={name} subtitle={name === label ? null : label} />,
      headerRight,
    };
  }, [headerRight, tab]);
  const closeGuidance = tab ? (closeUnknown.get(tab.tabId) ?? null) : null;
  return (
    <>
      <Stack.Screen options={options} />
      {model.transportError !== null ? (
        <TerminalTransportNotice message={model.transportError} />
      ) : null}
      {closeGuidance !== null ? (
        <TerminalNoticeStrip
          tone="warning"
          edge="top"
          title="Result unknown."
          message={`The close result was lost. ${closeGuidance}`}
        />
      ) : null}
      <TerminalPane
        model={model}
        terminalId={terminalId}
        onRemoveLost={(lost) => void close(lost)}
        onBack={goBack}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  actions: { flexDirection: "row", alignItems: "center" },
  closing: {
    minWidth: theme.touchTarget - 4,
    minHeight: theme.touchTarget - 4,
    alignItems: "center",
    justifyContent: "center",
  },
}));

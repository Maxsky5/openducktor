import {
  canRetryTerminalCreation,
  type TerminalTab,
} from "@openducktor/frontend-core/terminals/terminal-presentation-state";
import type { TerminalSessionsModel } from "@openducktor/frontend-core/terminals/use-terminals";
import type { ReactElement } from "react";
import { ActivityIndicator, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useCommandGate } from "@/host-session/active-session-context";
import { useAppTheme } from "@/theme/app-theme-context";
import { Button } from "@/ui/button";
import { EmptyState, ErrorState } from "@/ui/states";
import { Text } from "@/ui/text";
import { terminalScreenStatus } from "./terminal-list-model";
import { TerminalView } from "./terminal-view";

export type TerminalPaneProps = {
  model: TerminalSessionsModel;
  tabId: string;
  /** Removes a lost terminal from the list. The host has no terminal to close. */
  onRemoveLost: (tab: TerminalTab) => void;
  onBack?: (() => void) | undefined;
};

/** The terminal tab, its pending request, or the reason it cannot show. */
export function TerminalPane({
  model,
  tabId,
  onRemoveLost,
  onBack,
}: TerminalPaneProps): ReactElement {
  const gate = useCommandGate();
  const status = terminalScreenStatus(model, tabId);
  const back = onBack ? (
    <Button label="Back to Terminals" variant="outline" onPress={onBack} />
  ) : null;
  switch (status.kind) {
    case "loading":
      return <TerminalLoading label="Loading the terminal" />;
    case "pending":
      return <TerminalStart model={model} tab={status.tab} back={back} />;
    case "unavailable":
      return (
        <EmptyState
          icon="square-terminal"
          title="Terminals Unavailable"
          message={status.message}
          action={back}
        />
      );
    case "discovery_failed":
      return (
        <ErrorState
          title="Terminal Discovery Failed"
          message={status.message}
          onRetry={gate.open ? model.onRetryDiscovery : undefined}
          retryLabel="Retry Discovery"
          action={back}
        />
      );
    case "missing":
      return (
        <EmptyState
          icon="unlink"
          title="Terminal Not Found"
          message="The host no longer has this terminal. It closed, or the host restarted."
          action={back}
        />
      );
    case "lost":
      return (
        <EmptyState
          icon="unlink"
          title="Terminal Lost"
          message={status.tab.error}
          action={
            <Button
              label="Remove from List"
              variant="outline"
              onPress={() => onRemoveLost(status.tab)}
            />
          }
        />
      );
    case "ready":
      return (
        <TerminalView
          key={status.tab.terminalId}
          tab={status.tab}
          scopeKey={model.scopeKey}
          controller={model.controller}
          platform={model.platform}
          platformError={model.platformError}
          onLifecycle={model.onLifecycle}
          onTitleChange={model.onTitleChange}
          onForgotten={model.onForgotten}
        />
      );
  }
}

function TerminalStart({
  model,
  tab,
  back,
}: {
  model: TerminalSessionsModel;
  tab: Exclude<TerminalTab, { requestState: "ready" | "lost" }>;
  back: ReactElement | null;
}): ReactElement {
  const gate = useCommandGate();
  if (tab.requestState === "creating") return <TerminalLoading label="Starting the terminal" />;
  const { scopeKey, onRetryCreate } = model;
  const retry = canRetryTerminalCreation(tab) && gate.open && model.startBlockedReason === null;
  return (
    <ErrorState
      title="The Terminal Did Not Start"
      message={tab.error ?? "The host did not start the terminal. Return to Terminals to check it."}
      onRetry={
        retry && scopeKey !== null
          ? () => onRetryCreate(scopeKey, tab.tabId, tab.actionId)
          : undefined
      }
      retryLabel="Retry Start"
      action={back}
    />
  );
}

function TerminalLoading({ label }: { label: string }): ReactElement {
  const theme = useAppTheme();
  return (
    <View style={styles.loading} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={theme.colors.terminalMuted} />
      <Text variant="footnote" style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.space.md,
    backgroundColor: theme.colors.terminalPanel,
  },
  label: { color: theme.colors.terminalMuted },
}));

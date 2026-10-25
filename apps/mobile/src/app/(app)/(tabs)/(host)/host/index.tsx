import { Stack, useRouter } from "expo-router";
import { type ReactElement, useCallback } from "react";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { StyleSheet } from "react-native-unistyles";
import { useHostSessionState } from "@/app-shell/app-services";
import { diagnosticsSummaryPresentation } from "@/features/diagnostics/diagnostics-presentation";
import { useDiagnosticsModel } from "@/features/diagnostics/use-diagnostics-model";
import { DividedCard, SettingsIconTile, SettingsRow, SettingsSection } from "@/ui/settings-layout";
import { StatusPill } from "@/ui/status-pill";
import { useActiveSession, useCommandGate } from "@/host-session/active-session-context";
import { SavedHostsList } from "@/hosts/saved-hosts-list";
import { routes } from "@/navigation/routes";
import { useTabBarSpace } from "@/navigation/tab-bar/tab-bar-metrics";
import { IconButton } from "@/ui/icon-button";
import { Screen } from "@/ui/screen";

/** Keeps the hint and the Save control of a rename row above the keyboard. */
const RENAME_ACTIONS_SPACE = 88;

/** The diagnostics verdict, as the desktop diagnostics trigger. It shows while the host answers. */
function DiagnosticsSummary(): ReactElement | null {
  const { phase } = useCommandGate();
  const { model } = useDiagnosticsModel();
  if (phase.kind !== "connected") return null;
  const summary = model.summaryState;
  const presentation = diagnosticsSummaryPresentation(summary.tone);
  return (
    <StatusPill
      label={summary.label}
      variant={presentation.variant}
      busy={presentation.inProgress}
      accessibilityLabel={`Diagnostics: ${summary.label}`}
    />
  );
}

/**
 * The host tab: the saved hosts, as the desktop host connection dialog, with the current host
 * first, and the diagnostics of the host.
 */
export default function HostScreen(): ReactElement {
  const router = useRouter();
  const tabBarSpace = useTabBarSpace({ automaticInsets: true });
  const state = useHostSessionState();
  const { host } = useActiveSession();
  const { phase } = useCommandGate();
  const hosts = state.status === "active" ? state.hosts : [];
  const damagedHosts = state.status === "active" ? state.damagedHosts : [];
  const addHost = useCallback(() => router.push(routes.addHost()), [router]);
  const headerRight = useCallback(
    () => (
      // A plain control, so it does not compete with the create button of the tab bar.
      <IconButton icon="plus" color="label" accessibilityLabel="Add Host" onPress={addHost} />
    ),
    [addHost],
  );
  return (
    // Each host row shows its connection status, so the screen shows no banner.
    <Screen background="grouped" banner={false}>
      <Stack.Screen options={{ headerRight }} />
      <KeyboardAwareScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        bottomOffset={RENAME_ACTIONS_SPACE}
        contentContainerStyle={[styles.content, { paddingBottom: tabBarSpace }]}
      >
        <SavedHostsList
          hosts={hosts}
          damagedHosts={damagedHosts}
          activeHostId={host.id}
          activePhase={phase}
          onAddHost={addHost}
        />
        <SettingsSection title="Health" description="The checks of the connected host.">
          <DividedCard>
            <SettingsRow
              title="Diagnostics"
              description="Runtimes, host tools, and workspace checks"
              leading={<SettingsIconTile icon="shield-check" />}
              trailing={<DiagnosticsSummary />}
              onPress={() => router.push(routes.diagnostics())}
              accessibilityHint="Shows host, workspace, runtime, and tool health."
            />
          </DividedCard>
        </SettingsSection>
      </KeyboardAwareScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: {
    width: "100%",
    maxWidth: theme.layout.readableWidth,
    alignSelf: "center",
    gap: theme.space.xxl,
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.lg,
  },
}));

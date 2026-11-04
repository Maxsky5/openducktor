import { Modal, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StyleSheet } from "react-native-unistyles";
import { AppSystemBars } from "@/ui/app-system-bars";
import { useAppTheme } from "@/theme/app-theme-context";
import { usePathname } from "expo-router";
import { routes } from "@/navigation/routes";
import { isRemotePairingFailure } from "@openducktor/host-client/remote";
import { HostPairingForm } from "@/host-session/host-pairing-form";
import { ModalFeedbackHost } from "@/feedback/feedback-host";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { type PropsWithChildren, type ReactElement, useEffect, useSyncExternalStore } from "react";
import { MobileAppStateProvider } from "@/composition/mobile-app-state-provider";
import { ActiveSessionProvider, CommandGateProvider } from "@/host-session/active-session-context";
import type { ActiveHostSession } from "@/host-session/host-session-owner";
import { ResourceFilesProvider } from "@/platform/resource-files-context";
import { clearHostContentCaches } from "@/rich-content/lru-cache";
import { StartupPresentationProvider } from "@/features/session-startup/startup-presentation";
import { StartupProgressHost } from "@/features/session-startup/startup-progress-host";

/**
 * Everything that belongs to one host connection. The owner unmounts this tree before it disposes
 * the connection, so React effects release their subscriptions first. The unmount also clears the
 * parse, highlight, and size caches of the host content.
 */
export function ConnectionTree({
  session,
  children,
}: PropsWithChildren<{ session: ActiveHostSession }>): ReactElement {
  useEffect(() => clearHostContentCaches, []);
  return (
    <ActiveSessionProvider session={session}>
      <ClientConnectionProvider connection={session.connection}>
        <CommandGateProvider>
          <PairingModal remote={session.remote.remote} />
          <ResourceFilesProvider connectionKey={session.sessionKey}>
            <MobileAppStateProvider>
              <StartupPresentationProvider>
                {children}
                <StartupProgressHost />
              </StartupPresentationProvider>
            </MobileAppStateProvider>
          </ResourceFilesProvider>
        </CommandGateProvider>
      </ClientConnectionProvider>
    </ActiveSessionProvider>
  );
}

/**
 * The pairing page over the host content while the host asks for a code. Its route and state reads
 * stay here, so a navigation or status change does not render the whole connection tree.
 */
function PairingModal({ remote }: { remote: ActiveHostSession["remote"]["remote"] }): ReactElement {
  const theme = useAppTheme();
  const pathname = usePathname();
  const state = useSyncExternalStore(remote.subscribeState, remote.readState, remote.readState);
  const choosingHost =
    pathname === routes.addHost().pathname || pathname === routes.scanHost().pathname;
  const pairing = !choosingHost && isRemotePairingFailure(state.failure?.code);
  return (
    <Modal
      visible={pairing}
      onRequestClose={() => {
        void remote.disconnect();
      }}
    >
      <GestureHandlerRootView style={styles.fill}>
        <View style={styles.pairing}>
          <SafeAreaView style={styles.fill}>
            <AppSystemBars icons={theme.scheme === "dark" ? "light" : "dark"} />
            {pairing ? <HostPairingForm /> : null}
            {pairing ? <ModalFeedbackHost /> : null}
          </SafeAreaView>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  fill: { flex: 1 },
  pairing: { flex: 1, backgroundColor: theme.colors.background },
}));

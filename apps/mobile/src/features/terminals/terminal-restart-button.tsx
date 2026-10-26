import type { TerminalSummary } from "@openducktor/contracts";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import { terminalActivityOwnerKey } from "@openducktor/frontend-core/terminals/terminal-activity-store";
import {
  findTerminalActivity,
  restartTerminalCommand,
} from "@openducktor/frontend-core/terminals/terminal-command-restart";
import type { TerminalTransportController } from "@openducktor/frontend-core/terminals/terminal-transport-controller";
import { useSingleFlight } from "@openducktor/frontend-core/lib/use-single-flight";
import { type ReactElement, useCallback, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useFeedbackStore } from "@/app-shell/app-services";
import { toCommandFailure } from "@/host-session/command-outcome";
import { useAppTheme } from "@/theme/app-theme-context";
import { IconButton } from "@/ui/icon-button";
import { LoaderSpinner } from "@/ui/loader-spinner";

/**
 * The desktop "Restart command" control of a terminal whose command can run again, such as a
 * repository action. It restarts only the command that the activity stream reports, so a command
 * that changed in the meantime does not restart. A failure shows its reason. A lost result shows
 * the host guidance, because the host may have restarted the command.
 */
export function TerminalRestartButton({
  summary,
  controller,
}: {
  summary: TerminalSummary;
  controller: Pick<TerminalTransportController, "readActivity" | "subscribeActivity">;
}): ReactElement | null {
  const theme = useAppTheme();
  const host = useHostClient();
  const { feedback } = useFeedbackStore();
  const ownerKey = terminalActivityOwnerKey(summary.context);
  const read = useCallback(() => controller.readActivity(ownerKey), [controller, ownerKey]);
  const state = useSyncExternalStore(controller.subscribeActivity, read, read);
  const activity = findTerminalActivity(state, summary.terminalId);
  const [pending, setPending] = useState(false);
  // A double tap must not restart the command twice before the pending state renders.
  const flight = useSingleFlight();

  const restart = (): void => {
    if (!activity?.restartable) return;
    void flight.start(async () => {
      setPending(true);
      try {
        await restartTerminalCommand(activity, read, (request) => host.terminalRestart(request));
      } catch (cause) {
        const failure = toCommandFailure(cause, "The command did not restart.");
        feedback.show(failure.kind === "unknown" ? "warning" : "error", failure.title, {
          description: failure.message,
        });
      } finally {
        setPending(false);
      }
    });
  };

  if (pending) {
    return (
      <View
        style={styles.pending}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Restarting command"
      >
        <LoaderSpinner size={16} color={theme.desktop.mutedForeground} />
      </View>
    );
  }
  if (!activity?.restartable) return null;
  return (
    <IconButton
      icon="rotate-cw"
      command
      accessibilityLabel="Restart command"
      onPress={() => void restart()}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  pending: {
    minWidth: theme.touchTarget - 4,
    minHeight: theme.touchTarget - 4,
    alignItems: "center",
    justifyContent: "center",
  },
}));

import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SessionNoticeRow } from "./session-notice-row";
import { useSessionFacts } from "./use-session-facts";

/**
 * The runtime status message of a working session, as the desktop info row above the composer. A
 * session that stopped working can keep an old message, such as a retry notice, so it shows none.
 */
export function SessionRuntimeStatus(): ReactElement | null {
  const { runtimeStatusMessage, isWorking } = useSessionFacts();
  if (!isWorking || !runtimeStatusMessage) return null;
  return (
    <View style={styles.wrap}>
      <SessionNoticeRow tone="info">{runtimeStatusMessage}</SessionNoticeRow>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { paddingHorizontal: theme.space.md, paddingTop: theme.space.sm },
}));

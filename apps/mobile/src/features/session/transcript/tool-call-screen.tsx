import { runtimeKindSchema } from "@openducktor/contracts";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import { Stack } from "expo-router";
import { type ReactElement, useMemo, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { type RawRouteParams, routeParam } from "@/navigation/route-params";
import { Screen } from "@/ui/screen";
import { EmptyState } from "@/ui/states";
import { createDisclosureStore, DisclosureStoreProvider } from "./rows/disclosure";
import { ToolDetailsSheetContent } from "./rows/tool-details-sheet";
import { useToolCallSource } from "./tool-call-sources";
import { TranscriptFullViewSheet } from "./transcript-full-view";
import {
  type TranscriptFullView,
  type TranscriptRowsContextValue,
  TranscriptRowsProvider,
} from "./transcript-rows-context";

const TITLE = "Tool Call";

/**
 * The key of the session of the call. The route names the session by its identity, because the
 * key encodes its parts and a route param comes back decoded.
 */
const readSessionKey = (params: RawRouteParams): string | null => {
  const externalSessionId = routeParam(params.externalSessionId);
  const workingDirectory = routeParam(params.workingDirectory);
  const runtimeKind = runtimeKindSchema.safeParse(routeParam(params.runtimeKind));
  if (!externalSessionId || !workingDirectory || !runtimeKind.success) return null;
  return agentSessionIdentityKey({
    externalSessionId,
    runtimeKind: runtimeKind.data,
    workingDirectory,
  });
};

/**
 * The tool call route: the details of one call of the session screen under it, as the desktop
 * tool details panel shows them. It is a pushed screen, so a swipe or Back returns to the
 * session. It follows the live message of the call, so a running command shows its output as the
 * runtime sends it.
 */
export function ToolCallScreen({ params }: { params: RawRouteParams }): ReactElement {
  const sessionKey = readSessionKey(params) ?? "";
  const messageId = routeParam(params.messageId) ?? "";
  const title = routeParam(params.title) ?? TITLE;
  const { context, message } = useToolCallSource(sessionKey, messageId);
  const [fullView, setFullView] = useState<TranscriptFullView | null>(null);
  const [disclosures] = useState(createDisclosureStore);
  // A full diff that the details open shows over this screen, not over the session under it.
  const screenContext = useMemo<TranscriptRowsContextValue | null>(
    () => (context ? { ...context, openFullView: setFullView } : null),
    [context],
  );
  const meta = message?.meta?.kind === "tool" ? message.meta : null;
  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      {screenContext && message && meta ? (
        <DisclosureStoreProvider value={disclosures}>
          <TranscriptRowsProvider value={screenContext}>
            <SafeAreaView style={styles.fill} edges={["bottom"]}>
              <ToolDetailsSheetContent message={message} meta={meta} />
            </SafeAreaView>
            <TranscriptFullViewSheet view={fullView} onClose={() => setFullView(null)} />
          </TranscriptRowsProvider>
        </DisclosureStoreProvider>
      ) : (
        <EmptyState
          icon="file-question"
          title="Call Not Available"
          message="The session of this call is closed. Open the session again, then open the call."
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});

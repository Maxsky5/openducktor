import { useStartupTerminalOutput } from "@openducktor/frontend-core/terminals/use-startup-terminal-output";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, useWindowDimensions, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useClipboardCopy } from "@/platform/use-clipboard-copy";
import {
  IsolatedPageView,
  type IsolatedPageHandle,
} from "@/rich-content/isolated-page/isolated-page-view";
import {
  TERMINAL_PAGE_CHANNEL,
  type TerminalPageInbound,
  type TerminalPageOutbound,
} from "@/rich-content/isolated-page/terminal-page-messages";
import { useAppTheme } from "@/theme/app-theme-context";
import { Button } from "@/ui/button";
import { Text } from "@/ui/text";
import { terminalFontSize, terminalPageColors } from "../terminals/terminal-colors";
import { createTerminalOutputSession } from "../terminals/terminal-output-session";
import { TERMINAL_PAGE } from "../terminals/terminal-page";
import { useTerminalBridge } from "../terminals/use-terminal-bridge";
import { useStartupPresentation } from "./startup-presentation-context";
import { createStartupOutputReading } from "./startup-output-reading";

export function StartupTerminalOutput({
  attemptId,
  terminalId,
}: {
  attemptId: string;
  terminalId: string;
}): ReactElement {
  const { controller, transportError } = useStartupTerminalOutput(useTerminalBridge());
  const theme = useAppTheme();
  const { fontScale } = useWindowDimensions();
  const page = useRef<IsolatedPageHandle<TerminalPageInbound>>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pageReady, setPageReady] = useState(false);
  const [generation, setGeneration] = useState(0);
  const reading = useStartupPresentation().outputReading(attemptId, terminalId);
  const [outputText, setOutputText] = useState(reading.text);
  const { copyText } = useClipboardCopy();
  const session = useMemo(
    () =>
      controller
        ? createTerminalOutputSession({
            terminalId,
            transport: controller,
            frames: { requestFrame: requestAnimationFrame, cancelFrame: cancelAnimationFrame },
            onNotice: setNotice,
            onCopy: (text) => {
              void copyText(text, {
                copied: "Copied the terminal text.",
                failed: "Could not copy.",
              });
            },
          })
        : null,
    [controller, copyText, terminalId],
  );
  useEffect(() => () => session?.dispose(), [session]);
  const post = useCallback((message: TerminalPageInbound) => page.current?.post(message), []);
  const reader = useMemo(
    () => createStartupOutputReading({ reading, post, onText: setOutputText }),
    [post, reading],
  );
  const { terminalPanel, terminalForeground, terminalSelection } = theme.colors;
  const colors = useMemo(
    () => terminalPageColors({ terminalPanel, terminalForeground, terminalSelection }),
    [terminalPanel, terminalForeground, terminalSelection],
  );
  // Theme and text size can change after page admission, so this synchronizes external page state.
  // react-doctor-disable-next-line react-doctor/no-event-handler
  useEffect(() => {
    if (pageReady)
      post({
        type: "terminal_configure",
        colors,
        fontSize: terminalFontSize(fontScale),
        platform: null,
        inputEnabled: false,
        screenReaderMode: false,
        trackViewport: true,
      });
  }, [colors, fontScale, post, pageReady]);
  const receive = useCallback(
    (message: TerminalPageOutbound) => {
      if (message.type === "terminal_ready") session?.attachPage(post);
      else if (!reader.receive(message)) session?.receive(message);
    },
    [reader, post, session],
  );
  const restart = useCallback(() => {
    session?.detachPage();
    reader.reset();
    setPageReady(false);
    setGeneration((value) => value + 1);
  }, [reader, session]);
  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <Text variant="caption1" tone="secondary">
          Live output · read only
        </Text>
        <Button
          label="Copy selection"
          variant="plain"
          size="sm"
          onPress={() => post({ type: "terminal_copy_selection" })}
        />
        <Button
          label="Read output as text"
          variant="plain"
          size="sm"
          onPress={() => post({ type: "terminal_read_output" })}
        />
      </View>
      {outputText !== null ? (
        <ScrollView
          style={styles.textOutput}
          nestedScrollEnabled
          contentOffset={{ x: 0, y: reading.textOffset }}
          onScroll={(event) => {
            reading.textOffset = event.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={100}
        >
          <Text variant="monoSmall" selectable>
            {outputText || "No output yet."}
          </Text>
        </ScrollView>
      ) : null}
      <View style={styles.output}>
        {session ? (
          <IsolatedPageView
            key={`${terminalId}:${generation}`}
            ref={page}
            page={TERMINAL_PAGE}
            channel={TERMINAL_PAGE_CHANNEL}
            onReady={() => setPageReady(true)}
            onMessage={receive}
            onFailure={(message) => {
              session.detachPage();
              reader.reset();
              setNotice(message);
            }}
            onRestart={restart}
            style={styles.page}
          />
        ) : null}
      </View>
      {transportError || notice ? (
        <Text variant="caption1" tone="secondary" selectable>
          {transportError ?? notice}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { gap: theme.space.xs },
  toolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space.xs,
  },
  output: {
    height: 180,
    overflow: "hidden",
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.terminalPanel,
  },
  page: { flex: 1, backgroundColor: theme.colors.terminalPanel },
  textOutput: { maxHeight: 180 },
}));

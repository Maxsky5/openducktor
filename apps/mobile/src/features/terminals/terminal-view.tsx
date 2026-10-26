import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { TerminalTouchKey } from "@openducktor/frontend-core/terminals/terminal-keyboard-policy";
import type { TerminalTab } from "@openducktor/frontend-core/terminals/terminal-presentation-state";
import { checkHttpUrl } from "@openducktor/frontend-core/terminals/terminal-url-policy";
import type { TerminalSessionsModel } from "@openducktor/frontend-core/terminals/use-terminals";
import * as Clipboard from "expo-clipboard";
import { useIsFocused } from "expo-router";
import {
  memo,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, Linking, useWindowDimensions, View } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { StyleSheet } from "react-native-unistyles";
import { useCommandGate } from "@/host-session/active-session-context";
import { useClipboardCopy } from "@/platform/use-clipboard-copy";
import {
  type IsolatedPageHandle,
  IsolatedPageView,
} from "@/rich-content/isolated-page/isolated-page-view";
import { useAppTheme } from "@/theme/app-theme-context";
import { Button } from "@/ui/button";
import { useConfirm } from "@/ui/confirm-dialog";
import { ErrorState } from "@/ui/states";
import { Text } from "@/ui/text";
import { tabExitNotice } from "./terminal-list-model";
import { terminalFontSize, terminalPageColors } from "./terminal-colors";
import { TerminalKeyBar } from "./terminal-key-bar";
import { TerminalNoticeStrip } from "./terminal-notice-strip";
import { TERMINAL_PAGE } from "./terminal-page";
import {
  MAX_TERMINAL_PAGE_TEXT_LENGTH,
  TERMINAL_PAGE_CHANNEL,
  type TerminalPageInbound,
  type TerminalPageOutbound,
} from "@/rich-content/isolated-page/terminal-page-messages";
import { INPUT_DELIVERY_UNKNOWN, type TerminalSessionState } from "./terminal-session";
import { NO_TOUCH_MODIFIERS, touchModifiersReducer } from "./touch-key-modifiers";
import { useTerminalSession } from "./use-terminal-session";
import { KeyboardInsetView } from "@/ui/keyboard-inset-view";

/**
 * The terminal list members that one terminal view reads. The view takes them one by one, so a
 * list change that it does not read, such as a start or a running command, does not render it.
 */
type TerminalViewModel = Pick<
  TerminalSessionsModel,
  | "scopeKey"
  | "controller"
  | "platform"
  | "platformError"
  | "onLifecycle"
  | "onTitleChange"
  | "onForgotten"
>;

export type TerminalViewProps = TerminalViewModel & {
  tab: Extract<TerminalTab, { requestState: "ready" }>;
};

/**
 * One attached terminal: the isolated terminal page, its status notices, and the touch key row.
 * The view fits the space above the keyboard, so the page grid follows rotation and keyboard
 * changes. Terminal input follows the command gate and stops when the terminal exits. The view
 * attaches only while its screen has focus, because tab stacks keep other screens mounted.
 */
export const TerminalView = memo(function TerminalView({
  tab,
  scopeKey,
  controller,
  platform: hostPlatform,
  platformError,
  onLifecycle,
  onTitleChange,
  onForgotten,
}: TerminalViewProps): ReactElement {
  const theme = useAppTheme();
  const { fontScale } = useWindowDimensions();
  const gate = useCommandGate();
  const { feedback } = useClientConnection();
  const confirm = useConfirm();
  const focused = useIsFocused();
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const page = useRef<IsolatedPageHandle<TerminalPageInbound>>(null);
  const [reloads, setReloads] = useState(0);
  const [readyPageKey, setReadyPageKey] = useState<string | null>(null);
  const [pageFailure, setPageFailure] = useState<string | null>(null);
  const [modifiers, dispatchModifiers] = useReducer(touchModifiersReducer, NO_TOUCH_MODIFIERS);
  const terminalId = tab.terminalId;

  const post = useCallback((message: TerminalPageInbound) => page.current?.post(message), []);
  const openLink = useCallback(
    (url: string) => {
      const href = checkHttpUrl(url);
      if (href === null) {
        feedback.show("warning", "The link did not open.", {
          description: "Only web links from terminal output open on this device.",
        });
        return;
      }
      void confirm({ title: "Open this link?", message: href, confirmLabel: "Open" }).then(
        (confirmed) => {
          if (!confirmed) return;
          Linking.openURL(href).catch((cause) =>
            feedback.show("error", "The link did not open.", { description: errorMessage(cause) }),
          );
        },
      );
    },
    [confirm, feedback],
  );
  const { copyText } = useClipboardCopy();
  const copy = useCallback(
    (text: string) => {
      void copyText(text, { copied: "Copied the terminal text.", failed: "Could not copy." });
    },
    [copyText],
  );
  const handlers = useMemo(
    () => ({
      onLifecycle: (lifecycle: Parameters<typeof onLifecycle>[2]) => {
        if (scopeKey !== null) onLifecycle(scopeKey, terminalId, lifecycle);
      },
      onTitle: (title: string) => {
        if (scopeKey !== null) onTitleChange(scopeKey, terminalId, title);
      },
      onForgotten: (message: string) => {
        if (scopeKey !== null) onForgotten(scopeKey, terminalId, message);
      },
      onCopy: copy,
      onLink: openLink,
      onModifiersConsumed: () => dispatchModifiers({ type: "used" }),
    }),
    [copy, onForgotten, onLifecycle, onTitleChange, openLink, scopeKey, terminalId],
  );
  const { session, generation, state } = useTerminalSession({
    controller,
    terminalId,
    active: focused,
    commandsOpen: gate.open,
    handlers,
  });
  const inputEnabled = state.inputEnabled && tab.summary.lifecycle !== "exited";
  // Each session and each reload loads a new page, because a page draws one attachment.
  const pageKey = `${generation}:${reloads}`;
  const pageReady = readyPageKey === pageKey;

  // The colors follow their values, so only a theme change gives the page a new configuration,
  // and the page then applies its theme again.
  const { terminalPanel, terminalForeground, terminalSelection } = theme.colors;
  const colors = useMemo(
    () => terminalPageColors({ terminalPanel, terminalForeground, terminalSelection }),
    [terminalForeground, terminalPanel, terminalSelection],
  );
  const fontSize = terminalFontSize(fontScale);
  const platform = hostPlatform ?? null;
  useEffect(() => {
    if (!pageReady) return;
    post({ type: "terminal_configure", colors, fontSize, platform, inputEnabled });
  }, [colors, fontSize, inputEnabled, pageReady, platform, post]);
  useEffect(() => {
    if (pageReady) post({ type: "terminal_modifiers", ...modifiers });
  }, [modifiers, pageReady, post]);

  const onPageReady = useCallback(() => setReadyPageKey(pageKey), [pageKey]);
  const onPageMessage = useCallback(
    (message: TerminalPageOutbound) => {
      if (message.type === "terminal_ready")
        session?.attachPage(post, message.columns, message.rows);
      else session?.receive(message);
    },
    [post, session],
  );
  const onPageFailure = useCallback(
    (message: string) => {
      session?.detachPage();
      setReadyPageKey(null);
      setPageFailure(message);
    },
    [session],
  );
  const reloadPage = useCallback(() => {
    setPageFailure(null);
    setReloads((count) => count + 1);
  }, []);
  // The page process ended in the background. A new page attaches again and gets the whole screen
  // from the host.
  const restartPage = useCallback(() => {
    session?.detachPage();
    setReadyPageKey(null);
    setReloads((count) => count + 1);
  }, [session]);

  const sendKey = useCallback(
    (key: TerminalTouchKey) => {
      post({ type: "terminal_key", key, ...modifiers });
      dispatchModifiers({ type: "used" });
    },
    [modifiers, post],
  );
  const pasteText = useCallback(
    (text: string) => {
      if (text.length === 0) {
        feedback.show("info", "The clipboard has no text to paste.");
        return;
      }
      if (text.length > MAX_TERMINAL_PAGE_TEXT_LENGTH) {
        feedback.show("warning", "The clipboard text is too long to paste.", {
          description: "Paste at most 4 MiB of text at once.",
        });
        return;
      }
      post({ type: "terminal_paste", text });
    },
    [feedback, post],
  );
  const paste = useCallback(() => {
    Clipboard.getStringAsync().then(pasteText, (cause) =>
      feedback.show("error", "Could not read the clipboard.", {
        description: errorMessage(cause),
      }),
    );
  }, [feedback, pasteText]);
  // The page answers with the selected text, which goes to `copy`.
  const copySelection = useCallback(() => post({ type: "terminal_copy_selection" }), [post]);
  const toggleKeyboard = useCallback(() => {
    if (!pageReady) return;
    if (keyboardVisible) {
      post({ type: "terminal_blur" });
      return;
    }
    // The WebView takes native focus first. Android opens the keyboard for the focus of the
    // terminal field only in a focused WebView, as after a tap on the terminal.
    page.current?.focus();
    post({ type: "terminal_focus" });
  }, [keyboardVisible, pageReady, post]);

  const attachLabel = controller ? "Attaching to the terminal" : "Connecting terminals";
  const exit = state.exit ?? tabExitNotice(tab);
  const lifecycle = state.lifecycle ?? tab.summary.lifecycle;
  // The terminal screens cover the tab bar, so the keys keep the bottom safe area while the
  // keyboard is closed. The page refits on each size change, so the view takes the final keyboard
  // inset at once: the host gets one new grid for each keyboard change.
  return (
    <KeyboardInsetView style={styles.root} followFrames={false} bottomSafeArea>
      <View style={styles.body}>
        {/*
          Connection notices show above the terminal, as the desktop status messages. The screen
          shows the terminal connection notice once, also when it shows the terminal list next to
          this view. Notices about this terminal and its input show under it, above the keys, as the
          desktop exit notice.
        */}
        <TerminalTopNotices
          platformError={platformError}
          inputPaused={!gate.open && lifecycle !== "exited"}
        />
        <View style={styles.terminal}>
          {pageFailure === null && session !== null ? (
            <IsolatedPageView
              key={pageKey}
              ref={page}
              page={TERMINAL_PAGE}
              channel={TERMINAL_PAGE_CHANNEL}
              onReady={onPageReady}
              onMessage={onPageMessage}
              onFailure={onPageFailure}
              onRestart={restartPage}
              keyboardInput
              style={styles.page}
            />
          ) : null}
          {pageFailure !== null ? (
            <View style={styles.failure}>
              <ErrorState
                title="The Terminal View Stopped"
                message={`${pageFailure} The host keeps the terminal. Reload the view to attach again.`}
                onRetry={reloadPage}
                retryLabel="Reload Terminal"
              />
            </View>
          ) : null}
          {pageFailure === null && !state.hydrated ? (
            <View style={styles.overlay} pointerEvents="none">
              <View
                style={styles.progress}
                accessibilityRole="progressbar"
                accessibilityLabel={attachLabel}
              >
                <ActivityIndicator color={theme.colors.terminalMuted} />
                <Text variant="footnote" style={styles.progressText}>
                  {attachLabel}
                </Text>
              </View>
            </View>
          ) : null}
        </View>
        <TerminalBottomNotices
          state={state}
          exited={lifecycle === "exited"}
          exit={exit}
          onDismissInputNotice={() => session?.dismissInputNotice()}
        />
      </View>
      <TerminalKeyBar
        inputEnabled={inputEnabled && pageReady}
        modifiers={modifiers}
        canCopy={state.hasSelection}
        keyboardVisible={keyboardVisible}
        onKey={sendKey}
        onToggleModifier={(modifier) => dispatchModifiers({ type: "toggled", modifier })}
        onPaste={paste}
        onPasteText={pasteText}
        onCopy={copySelection}
        onToggleKeyboard={toggleKeyboard}
      />
    </KeyboardInsetView>
  );
});

/** The notices above the terminal: unavailable shortcuts and paused input. */
function TerminalTopNotices({
  platformError,
  inputPaused,
}: {
  platformError: string | null;
  inputPaused: boolean;
}): ReactElement {
  return (
    <>
      {platformError !== null ? (
        <TerminalNoticeStrip
          tone="warning"
          edge="top"
          title="Terminal shortcuts unavailable."
          message={`${platformError} Host keyboard shortcuts do not work. Open the terminal again to retry.`}
        />
      ) : null}
      {inputPaused ? (
        <TerminalNoticeStrip
          tone="muted"
          edge="top"
          title="Input is paused."
          message="Terminal input works again when the host connection is live."
        />
      ) : null}
    </>
  );
}

/** The notices under the terminal: a terminal problem, its exit, and input that did not arrive. */
function TerminalBottomNotices({
  state,
  exited,
  exit,
  onDismissInputNotice,
}: {
  state: TerminalSessionState;
  exited: boolean;
  exit: TerminalSessionState["exit"];
  onDismissInputNotice: () => void;
}): ReactElement {
  const { inputNotice } = state;
  return (
    <>
      {state.attention ? (
        <TerminalNoticeStrip
          tone="error"
          edge="bottom"
          title="Terminal problem."
          message={state.attention}
        />
      ) : null}
      {exited ? (
        <TerminalNoticeStrip
          tone={exit?.isFailure ? "warning" : "muted"}
          edge="bottom"
          title="The terminal exited."
          message={`${exit?.text ?? "The process ended."} It keeps its output and takes no input.`}
        />
      ) : null}
      {inputNotice?.kind === "unknown" ? (
        <TerminalNoticeStrip
          tone="warning"
          edge="bottom"
          title={`${INPUT_DELIVERY_UNKNOWN}.`}
          message={`${inputNotice.guidance} The app does not send this input again.`}
          action={
            <Button label="Dismiss" size="sm" variant="outline" onPress={onDismissInputNotice} />
          }
        />
      ) : null}
      {inputNotice?.kind === "not_sent" ? (
        <TerminalNoticeStrip
          tone="warning"
          edge="bottom"
          title="Input not sent."
          message={`${inputNotice.message} Type it again when the terminal is connected.`}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The key row color fills the space under the keys: the safe area and the keyboard space.
  root: { flex: 1, backgroundColor: theme.colors.terminalSurface },
  body: { flex: 1, backgroundColor: theme.colors.terminalPanel },
  terminal: { flex: 1, backgroundColor: theme.colors.terminalPanel },
  page: { flex: 1, backgroundColor: theme.colors.terminalPanel },
  failure: { flex: 1, backgroundColor: theme.colors.background },
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  progress: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.terminalSurface,
  },
  progressText: { color: theme.colors.terminalMuted },
}));

import {
  HTML_PREVIEW_MIN_CONTENT_HEIGHT,
  HTML_PREVIEW_MOBILE_MAX_INLINE_HEIGHT,
} from "@openducktor/contracts";
import { createHtmlPreviewHeightGovernor } from "@openducktor/frontend-core/sessions/html-preview-height-governor";
import {
  type ComponentProps,
  type ComponentRef,
  memo,
  type ReactElement,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import { appActivitySource } from "@/host-session/device-sources";
import {
  buildHtmlPreviewWrapper,
  type HtmlPreviewScroll,
  parseHtmlPreviewWebViewMessage,
} from "@/rich-content/isolated-page/html-preview-page";
import { buildMobileHtmlPreviewThemeCss } from "@/rich-content/isolated-page/html-preview-theme";
import { LOCKED_WEB_VIEW_PROPS } from "@/rich-content/isolated-page/locked-web-view-props";
import { PAGE_BASE_URL } from "@/rich-content/isolated-page/web-view-bases";
import { useLinkOpener } from "@/rich-content/links/use-link-opener";
import { useAppTheme } from "@/theme/app-theme-context";
import { Callout } from "@/ui/callout";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { Text } from "@/ui/text";
import { allowsHtmlPreviewRequest } from "./html-preview-navigation";

const OPEN_LINK_COOLDOWN_MS = 1_000;
const WEB_VIEW_STYLE = { flex: 1, backgroundColor: "transparent" } as const;

type WebViewErrorHandler = NonNullable<ComponentProps<typeof WebView>["onError"]>;

type PreviewTheme = {
  css: string;
  background: string;
  foreground: string;
};

const samePreviewTheme = (left: PreviewTheme, right: PreviewTheme): boolean =>
  left.css === right.css &&
  left.background === right.background &&
  left.foreground === right.foreground;

/**
 * Isolated memoized WebView wrapper. On Android, `react-native-webview` constructs a fresh
 * `newSource` object on every React render and `RNCWebViewManagerImpl.loadSource()` calls
 * `loadDataWithBaseURL()` unconditionally for HTML sources without checking equality. Keeping
 * `<WebView>` behind `memo` with strictly stable props prevents state changes (`started`, row
 * height, or live theme updates) from reloading the page and wiping interactive state.
 */
const StablePreviewWebView = memo(function StablePreviewWebView({
  webViewRef,
  source,
  scroll,
  title,
  onMessage,
  onShouldStartLoadWithRequest,
  onLoadEnd,
  onProcessEnded,
  onError,
}: {
  webViewRef: RefObject<ComponentRef<typeof WebView> | null>;
  source: { html: string; baseUrl: string };
  scroll: HtmlPreviewScroll;
  title: string;
  onMessage: (event: WebViewMessageEvent) => void;
  onShouldStartLoadWithRequest: (request: WebViewNavigation) => boolean;
  onLoadEnd: () => void;
  onProcessEnded: () => void;
  onError: WebViewErrorHandler;
}): ReactElement {
  return (
    <WebView
      ref={webViewRef}
      source={source}
      onMessage={onMessage}
      onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
      onLoadEnd={onLoadEnd}
      onContentProcessDidTerminate={onProcessEnded}
      onRenderProcessGone={onProcessEnded}
      onError={onError}
      // Inline, the page fits its content height without vertical WebView scrolling, so a
      // vertical swipe always scrolls the transcript. Horizontal drags stay inside the preview.
      scrollEnabled={scroll === "full"}
      nestedScrollEnabled={scroll === "full"}
      showsVerticalScrollIndicator={scroll === "full"}
      accessibilityLabel={`${title} HTML preview`}
      style={WEB_VIEW_STYLE}
      {...LOCKED_WEB_VIEW_PROPS}
    />
  );
});

/**
 * A published HTML page in a WebView: the app builds the trusted main-frame wrapper with a
 * per-mount random capability token bound inside its private closure, and the page runs in a
 * sandboxed `srcdoc` frame of it. Only messages carrying that exact token are accepted, so the
 * opaque-origin inner frame cannot forge resize, link-open, or failure events.
 */
export const HtmlPreviewViewer = memo(function HtmlPreviewViewer({
  html,
  title,
  scroll,
  initialHeight,
  onHeightChange,
  style,
}: {
  html: string;
  title: string;
  scroll: HtmlPreviewScroll;
  initialHeight?: number | undefined;
  onHeightChange?: ((height: number) => void) | undefined;
  style?: StyleProp<ViewStyle> | undefined;
}): ReactElement {
  const theme = useAppTheme();
  const openLink = useLinkOpener(undefined);
  const themeCss = useMemo(() => buildMobileHtmlPreviewThemeCss(theme), [theme]);
  const currentTheme = useMemo<PreviewTheme>(
    () => ({
      css: themeCss,
      background: theme.desktop.chatBackground,
      foreground: theme.desktop.foreground,
    }),
    [theme.desktop.chatBackground, theme.desktop.foreground, themeCss],
  );
  const webViewRef = useRef<ComponentRef<typeof WebView>>(null);
  const appliedThemeRef = useRef(currentTheme);
  const [initialTheme, setInitialTheme] = useState(currentTheme);
  const [session, setSession] = useState(() => ({
    generation: 0,
    messageToken: crypto.randomUUID(),
  }));
  const [governor] = useState(() =>
    createHtmlPreviewHeightGovernor({
      minHeight: HTML_PREVIEW_MIN_CONTENT_HEIGHT,
      maxHeight: HTML_PREVIEW_MOBILE_MAX_INLINE_HEIGHT,
    }),
  );
  const source = useMemo(
    () => ({
      html: buildHtmlPreviewWrapper({
        html,
        scroll,
        themeCss: initialTheme.css,
        background: initialTheme.background,
        foreground: initialTheme.foreground,
        messageToken: session.messageToken,
      }),
      baseUrl: PAGE_BASE_URL,
    }),
    [html, scroll, initialTheme, session.messageToken],
  );
  const [failure, setFailure] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const firstLoadDone = useRef(false);
  const wentToBackground = useRef(false);
  const lastOpenLinkAtRef = useRef(0);

  const latestRef = useRef({
    currentTheme,
    initialHeight: initialHeight ?? null,
    messageToken: session.messageToken,
    onHeightChange,
    openLink,
    scroll,
  });
  useLayoutEffect(() => {
    latestRef.current = {
      currentTheme,
      initialHeight: initialHeight ?? null,
      messageToken: session.messageToken,
      onHeightChange,
      openLink,
      scroll,
    };
  }, [currentTheme, initialHeight, onHeightChange, openLink, scroll, session.messageToken]);

  const injectTheme = useCallback((next: PreviewTheme) => {
    appliedThemeRef.current = next;
    webViewRef.current?.injectJavaScript(
      `window.__odtApplyTheme?.(${JSON.stringify(next.css)},${JSON.stringify(next.background)},${JSON.stringify(next.foreground)});true;`,
    );
  }, []);

  // Reset the height governor only for a new document or WebView generation; resetting on
  // `initialHeight` updates would clear its loop counter after every accepted resize.
  useEffect(() => {
    governor.reset(latestRef.current.initialHeight);
  }, [governor, html, session.generation]);

  // Push live theme updates into the running wrapper without reloading the page or losing state.
  // Theme changes that arrive before `onLoadEnd` are replayed in `markLoaded`.
  useEffect(() => {
    if (!firstLoadDone.current || samePreviewTheme(appliedThemeRef.current, currentTheme)) {
      return;
    }
    injectTheme(currentTheme);
  }, [currentTheme, injectTheme]);

  useEffect(
    () =>
      appActivitySource.subscribe((activity) => {
        if (activity === "background") wentToBackground.current = true;
      }),
    [],
  );

  // A pending image holds back the WebView load event. Hide the starting state at a fixed limit so
  // the page stays usable while its own assets load.
  useEffect(() => {
    if (started) return;
    const timer = setTimeout(() => setStarted(true), 800);
    return () => clearTimeout(timer);
  }, [session.generation, started]);

  const allowRequest = useCallback(
    (request: WebViewNavigation) => allowsHtmlPreviewRequest(request.url, firstLoadDone.current),
    [],
  );

  const markLoaded = useCallback(() => {
    firstLoadDone.current = true;
    setStarted(true);
    const next = latestRef.current.currentTheme;
    if (!samePreviewTheme(appliedThemeRef.current, next)) {
      injectTheme(next);
    }
  }, [injectTheme]);

  const handleProcessEnded = useCallback(() => {
    if (wentToBackground.current) {
      wentToBackground.current = false;
      firstLoadDone.current = false;
      setStarted(false);
      setFailure(null);
      const next = latestRef.current.currentTheme;
      appliedThemeRef.current = next;
      setInitialTheme(next);
      setSession((current) => ({
        generation: current.generation + 1,
        messageToken: crypto.randomUUID(),
      }));
      return;
    }
    setFailure("The HTML preview stopped. Open it again to start a new page.");
  }, []);

  const handleError = useCallback<WebViewErrorHandler>((event) => {
    setFailure(`The HTML preview did not load: ${event.nativeEvent.description}`);
  }, []);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const latest = latestRef.current;
      const message = parseHtmlPreviewWebViewMessage(event.nativeEvent.data, latest.messageToken);
      if (message === null) return;
      if (message.type === "resize") {
        if (latest.scroll !== "inline" || !latest.onHeightChange) return;
        const height = governor.accept(message.height);
        if (height !== null) latest.onHeightChange(height);
        return;
      }
      if (message.type === "open-link") {
        const now = Date.now();
        if (now - lastOpenLinkAtRef.current < OPEN_LINK_COOLDOWN_MS) return;
        try {
          const url = new URL(message.url);
          if (url.protocol !== "http:" && url.protocol !== "https:") return;
          lastOpenLinkAtRef.current = now;
          latest.openLink(url.href);
        } catch {
          return;
        }
        return;
      }
      if (message.type === "failed") {
        setFailure("The preview navigated away repeatedly and was stopped.");
      }
    },
    [governor],
  );

  if (failure !== null) {
    return (
      <View style={[styles.container, style]}>
        <Callout
          tone="warning"
          title="This preview did not open."
          message={`${failure} Open the page full screen to read the published HTML.`}
        />
      </View>
    );
  }
  return (
    <View style={[styles.container, style]}>
      <StablePreviewWebView
        key={session.generation}
        webViewRef={webViewRef}
        source={source}
        scroll={scroll}
        title={title}
        onMessage={handleMessage}
        onShouldStartLoadWithRequest={allowRequest}
        onLoadEnd={markLoaded}
        onProcessEnded={handleProcessEnded}
        onError={handleError}
      />
      {started ? null : (
        <View style={styles.loading} pointerEvents="none">
          <LoaderSpinner size={14} />
          <Text style={styles.loadingText}>Loading preview…</Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1 },
  loading: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.space.sm,
    backgroundColor: theme.desktop.chatBackground,
  },
  loadingText: {
    ...theme.type.footnote,
    color: theme.desktop.mutedForeground,
  },
}));

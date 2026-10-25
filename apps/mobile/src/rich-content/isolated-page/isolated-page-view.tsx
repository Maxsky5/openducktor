/**
 * Isolated pages: self-contained HTML pages in a locked WebView, for content that native views
 * cannot draw, such as math, Mermaid diagrams, or a terminal.
 *
 * Add a page:
 * 1. Write `src/rich-content/isolated-page/page-src/<name>.ts`. Start it with
 *    `startPageChannel(channel, handlers)` from `page-src/shared/page-runtime.ts`. Shared page code
 *    goes in `page-src/shared/`, because each top-level `.ts` file is a page.
 * 2. Define the messages with `definePageChannel(inbound, outbound)` from `page-channel.ts`,
 *    in a module without React Native imports, so the page can bundle it.
 * 3. Run `bun run build:page` in apps/mobile. It writes `assets/pages/<name>.html` with inline JS,
 *    CSS, and fonts, and a Content Security Policy that allows only inline data.
 * 4. Define the page with `defineIsolatedPage(name, require("../../../assets/pages/<name>.html"))`
 *    from `page-asset.ts`, and render `IsolatedPageView` with the page and its channel.
 *
 * The WebView is transparent, so the page shows on the background of its parent and no white page
 * shows while it loads. A view whose page draws its content later can pass `revealed={false}`
 * until the content is ready; the page then fades in.
 *
 * The system can end the page process while the app is in the background, such as to free
 * memory. The page is gone then, so the view asks its parent through `onRestart` to mount a new
 * view, once for each time the app went to the background. A process that ends while the app
 * stays in the foreground is a page failure: a new page would most likely end the same way.
 *
 * The view sends a message only after the page posts `page_ready`. Each message in both
 * directions is JSON that the channel schemas validate. The WebView loads the HTML as a string,
 * has no file access or storage, and starts no navigation after the first load. Links go to the
 * app through page messages; they never open in the WebView.
 */
import type { ComponentRef, Ref } from "react";
import { type ReactElement, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { findNodeHandle, Platform, type StyleProp, View, type ViewStyle } from "react-native";
import Animated, { type CSSStyle } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { appActivitySource } from "@/host-session/device-sources";
import { showKeyboard } from "../../../modules/openducktor-keyboard";
import { motion } from "@/theme/tokens";
import {
  WebView,
  type WebViewMessageEvent,
  type WebViewNavigation,
  type WebViewProps,
} from "react-native-webview";
import { type IsolatedPage, useIsolatedPageHtml } from "./page-asset";
import { decodePageToAppMessage, encodePageMessage, type PageChannel } from "./page-channel";

export type IsolatedPageHandle<Inbound> = {
  /** Sends a message to the page. Call it only after `onReady`. */
  post(message: Inbound): void;
  /**
   * Gives the WebView native input focus and opens the keyboard. Call it before a message that
   * focuses a field of the page. Android opens the keyboard for a field that a script focuses only
   * on an explicit request, so the keyboard module asks once the WebView has the focus. Call it
   * only after `onReady`.
   */
  focus(): void;
};

export type IsolatedPageViewProps<Inbound, Outbound> = {
  page: IsolatedPage;
  channel: PageChannel<Inbound, Outbound>;
  ref?: Ref<IsolatedPageHandle<Inbound>> | undefined;
  /** The page listens for messages. Send the first message here. */
  onReady: () => void;
  onMessage: (message: Outbound) => void;
  /**
   * The page file did not load, the page sent an invalid message, or the page process ended while
   * the app stayed in the foreground.
   */
  onFailure: (message: string) => void;
  /**
   * The page process ended after the app went to the background. Mount a new view in place of
   * this one, such as with a new `key`.
   */
  onRestart: () => void;
  style?: StyleProp<ViewStyle> | undefined;
  /** Lets the page scroll. Block pages size to their content and do not scroll. */
  scrollEnabled?: boolean | undefined;
  /**
   * The page takes keyboard input, such as the terminal page. The page can then show the keyboard
   * when the app asks it to focus, and iOS shows no form bar above the keyboard.
   */
  keyboardInput?: boolean | undefined;
  /**
   * False keeps the page hidden, such as while it draws its first content. The page fades in
   * when it turns true.
   */
  revealed?: boolean | undefined;
};

// The WebView class adds its type argument to its props, and its default `undefined` empties them.
type NoExtraProps = Record<never, never>;
type PageWebView = WebView<NoExtraProps>;

// Every request must reach `allowRequest`, which blocks it. With a shorter list,
// react-native-webview opens each other URL with `Linking.openURL`, outside the app link policy.
const ALL_ORIGINS = ["*"];
const NO_DATA_DETECTORS: NonNullable<WebViewProps["dataDetectorTypes"]> = ["none"];
const PAGE_BASE_URL = "about:blank";

export function IsolatedPageView<Inbound, Outbound>({
  page,
  channel,
  ref,
  onReady,
  onMessage,
  onFailure,
  onRestart,
  style,
  scrollEnabled = false,
  keyboardInput = false,
  revealed = true,
}: IsolatedPageViewProps<Inbound, Outbound>): ReactElement {
  const pageHtml = useIsolatedPageHtml(page, onFailure);
  const webView = useRef<PageWebView>(null);
  // The WebView ref is a handle of commands, not a view, so the keyboard module gets this view.
  const container = useRef<ComponentRef<typeof View>>(null);
  const ready = useRef(false);
  const firstLoadDone = useRef(false);
  const wentToBackground = useRef(false);
  useEffect(
    () =>
      appActivitySource.subscribe((activity) => {
        if (activity === "background") wentToBackground.current = true;
      }),
    [],
  );

  useImperativeHandle(ref, () => {
    const readyWebView = (): PageWebView => {
      if (!ready.current || webView.current === null) {
        throw new Error(`The ${page.name} page is not ready. Use it after onReady.`);
      }
      return webView.current;
    };
    return {
      post: (message: Inbound) => {
        readyWebView().postMessage(encodePageMessage(channel.inbound, message));
      },
      focus: () => {
        readyWebView().requestFocus();
        if (Platform.OS !== "android") return;
        const viewTag = findNodeHandle(container.current);
        if (viewTag === null || viewTag === undefined)
          throw new Error(`The ${page.name} page has no native view.`);
        void showKeyboard(viewTag);
      },
    };
  }, [channel, page.name]);

  const allowRequest = useCallback(
    (request: WebViewNavigation) => !firstLoadDone.current && request.url === PAGE_BASE_URL,
    [],
  );
  const markLoaded = useCallback(() => {
    firstLoadDone.current = true;
  }, []);
  const receive = useCallback(
    (event: WebViewMessageEvent) => {
      const decoded = decodePageToAppMessage(channel.outbound, event.nativeEvent.data);
      if (!decoded.ok) {
        onFailure(
          `The ${page.name} page sent a message that the app cannot read: ${decoded.error}`,
        );
      } else if (decoded.message.kind === "ready") {
        ready.current = true;
        onReady();
      } else {
        onMessage(decoded.message.message);
      }
    },
    [channel, onFailure, onMessage, onReady, page.name],
  );
  const processEnded = useCallback(() => {
    ready.current = false;
    if (wentToBackground.current) onRestart();
    else onFailure(`The ${page.name} page stopped.`);
  }, [onFailure, onRestart, page.name]);

  if (pageHtml.status !== "ready") return <View style={style} />;
  return (
    <Animated.View ref={container} style={[style, revealed ? REVEALED : HIDDEN]}>
      <WebView<NoExtraProps>
        ref={webView}
        source={{ html: pageHtml.html, baseUrl: PAGE_BASE_URL }}
        originWhitelist={ALL_ORIGINS}
        onShouldStartLoadWithRequest={allowRequest}
        onLoadEnd={markLoaded}
        onMessage={receive}
        onContentProcessDidTerminate={processEnded}
        onRenderProcessGone={processEnded}
        onError={(event) =>
          onFailure(`The ${page.name} page did not load: ${event.nativeEvent.description}`)
        }
        javaScriptEnabled
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        domStorageEnabled={false}
        cacheEnabled={false}
        // iOS gives the page a data store of its own. On Android the prop clears the cookies and
        // the cache of the whole app on the main thread at each mount. The page loads from a
        // string, with no network and no storage, so it needs no such reset.
        incognito={Platform.OS === "ios"}
        thirdPartyCookiesEnabled={false}
        sharedCookiesEnabled={false}
        geolocationEnabled={false}
        mixedContentMode="never"
        allowsLinkPreview={false}
        keyboardDisplayRequiresUserAction={!keyboardInput}
        hideKeyboardAccessoryView={keyboardInput}
        // An array: the Android wrapper passes a string unchanged, and the shared native prop parser
        // reads only an array. A string crashes the app when the view mounts.
        dataDetectorTypes={NO_DATA_DETECTORS}
        mediaPlaybackRequiresUserAction
        saveFormDataDisabled
        // The page scales its text with the font scale in its messages, so Android must not scale it again.
        textZoom={100}
        webviewDebuggingEnabled={__DEV__}
        scrollEnabled={scrollEnabled}
        bounces={false}
        overScrollMode="never"
        // On Android, a nested-scroll WebView keeps every touch from its parent list. A page that
        // does not scroll must let the list take the drag.
        nestedScrollEnabled={scrollEnabled}
        showsVerticalScrollIndicator={scrollEnabled}
        style={styles.webView}
      />
    </Animated.View>
  );
}

// The page fades in once. Opacity changes are kept with reduced motion, because they move nothing.
const HIDDEN: CSSStyle<ViewStyle> = { opacity: 0 };
const REVEALED: CSSStyle<ViewStyle> = {
  opacity: 1,
  transitionProperty: "opacity",
  transitionDuration: motion.base,
  transitionTimingFunction: motion.easeOut,
};

const styles = StyleSheet.create({
  // A transparent WebView is not opaque on iOS and draws no background on Android.
  webView: { flex: 1, backgroundColor: "transparent" },
});

import { Platform } from "react-native";
import type { WebViewProps } from "react-native-webview";

/**
 * The props that every WebView with an isolated page keeps. Callers add their source, callbacks,
 * scroll and keyboard flags, and style. A caller must not override a prop in this object.
 */
export const LOCKED_WEB_VIEW_PROPS = {
  // Every request must reach the caller's allowRequest callback, which blocks it. With a shorter
  // list, react-native-webview opens each other URL with Linking.openURL, outside the app link
  // policy.
  originWhitelist: ["*"],
  javaScriptEnabled: true,
  javaScriptCanOpenWindowsAutomatically: false,
  setSupportMultipleWindows: false,
  allowFileAccess: false,
  allowFileAccessFromFileURLs: false,
  allowUniversalAccessFromFileURLs: false,
  domStorageEnabled: false,
  cacheEnabled: false,
  // iOS gives the page an ephemeral data store of its own. On Android the prop clears the cookies
  // and cache of the whole app synchronously on the main thread at each mount; cookies and storage
  // are already disabled above.
  incognito: Platform.OS === "ios",
  thirdPartyCookiesEnabled: false,
  sharedCookiesEnabled: false,
  geolocationEnabled: false,
  mediaCapturePermissionGrantType: "deny",
  mixedContentMode: "never",
  allowsLinkPreview: false,
  // An array: the Android wrapper passes a string unchanged, and the shared native prop parser
  // reads only an array. A string crashes the app when the view mounts.
  dataDetectorTypes: ["none"],
  mediaPlaybackRequiresUserAction: true,
  saveFormDataDisabled: true,
  // The page scales its own text, so Android must not scale it again.
  textZoom: 100,
  webviewDebuggingEnabled: __DEV__,
  bounces: false,
  overScrollMode: "never",
} satisfies WebViewProps;

import {
  buildHtmlPreviewThemeSheet,
  type HtmlPreviewSurface,
  type HtmlPreviewThemeSheet,
} from "@openducktor/frontend-core/sessions/html-preview-document";
import { useSyncExternalStore } from "react";

const THEME_VARIABLES = [
  "--background",
  "--chat-background",
  "--chat-surface",
  "--foreground",
  "--muted",
  "--muted-foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--destructive-foreground",
  "--destructive-surface",
  "--destructive-surface-foreground",
  "--success-accent",
  "--success-surface",
  "--success-surface-foreground",
  "--warning-accent",
  "--warning-surface",
  "--warning-surface-foreground",
  "--info-accent",
  "--info-surface",
  "--info-surface-foreground",
  "--border",
  "--input",
  "--ring",
] as const;

const FALLBACK_SANS = '"Space Grotesk", "Avenir Next", "Segoe UI", sans-serif';
const FALLBACK_MONO = '"IBM Plex Mono", "SF Mono", Menlo, Monaco, Consolas, monospace';

type HtmlPreviewTheme = {
  css: string;
  surface: HtmlPreviewSurface;
};

const readThemeFromStyles = (root: HTMLElement, styles: CSSStyleDeclaration): HtmlPreviewTheme => {
  const appearance = root.classList.contains("dark") ? "dark" : "light";
  const variables: Record<string, string> = {};
  for (const name of THEME_VARIABLES) {
    const value = styles.getPropertyValue(name).trim();
    if (value.length > 0) variables[name] = value;
  }
  const bodyFont = root.ownerDocument.body
    ? getComputedStyle(root.ownerDocument.body).fontFamily.trim()
    : "";
  const fontSans = styles.getPropertyValue("--app-font-sans").trim() || bodyFont || FALLBACK_SANS;
  const fontMono = styles.getPropertyValue("--app-font-mono").trim() || FALLBACK_MONO;
  const radius = styles.getPropertyValue("--radius").trim();
  const theme: HtmlPreviewThemeSheet = {
    appearance,
    variables,
    fontSans,
    fontMono,
  };
  if (radius.length > 0) theme.radius = radius;
  const background =
    styles.getPropertyValue("--chat-background").trim() ||
    styles.getPropertyValue("--background").trim();
  return {
    css: buildHtmlPreviewThemeSheet(theme),
    surface: { appearance, background },
  };
};

const sameTheme = (left: HtmlPreviewTheme, right: HtmlPreviewTheme): boolean =>
  left.css === right.css &&
  left.surface.appearance === right.surface.appearance &&
  left.surface.background === right.surface.background;

let cachedTheme: HtmlPreviewTheme | null = null;
let sharedObserver: MutationObserver | null = null;
const themeListeners = new Set<() => void>();

const refreshSharedTheme = (): HtmlPreviewTheme => {
  const root = document.documentElement;
  const next = readThemeFromStyles(root, getComputedStyle(root));
  if (cachedTheme !== null && sameTheme(cachedTheme, next)) {
    return cachedTheme;
  }
  cachedTheme = next;
  return next;
};

const getSharedThemeSnapshot = (): HtmlPreviewTheme => cachedTheme ?? refreshSharedTheme();

const subscribeSharedTheme = (listener: () => void): (() => void) => {
  themeListeners.add(listener);
  if (sharedObserver === null) {
    refreshSharedTheme();
    sharedObserver = new MutationObserver(() => {
      const previous = cachedTheme;
      const next = refreshSharedTheme();
      if (previous === next) return;
      for (const notify of themeListeners) notify();
    });
    sharedObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }
  return () => {
    themeListeners.delete(listener);
    if (themeListeners.size === 0 && sharedObserver !== null) {
      sharedObserver.disconnect();
      sharedObserver = null;
      cachedTheme = null;
    }
  };
};

export function useHtmlPreviewTheme(): HtmlPreviewTheme {
  return useSyncExternalStore(subscribeSharedTheme, getSharedThemeSnapshot, getSharedThemeSnapshot);
}

import { buildHtmlPreviewThemeSheet } from "@openducktor/frontend-core/sessions/html-preview-document";
import type { AppTheme } from "@/theme/tokens";

const SYSTEM_SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
const SYSTEM_MONO = '"SF Mono", SFMono-Regular, Menlo, Consolas, monospace';

const cssName = (name: string): string =>
  `--${name.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;

/**
 * The desktop theme tokens on a phone. A WebView cannot load the bundled app fonts, so the page
 * uses the platform system stacks. The page starts on the transcript surface, which keeps an
 * unstyled page from showing a white frame in dark mode.
 */
export function buildMobileHtmlPreviewThemeCss(theme: AppTheme): string {
  const variables = Object.fromEntries(
    Object.entries(theme.desktop).map(([name, value]) => [cssName(name), value]),
  );
  return buildHtmlPreviewThemeSheet({
    appearance: theme.scheme,
    variables,
    fontSans: SYSTEM_SANS,
    fontMono: SYSTEM_MONO,
    radius: `${theme.radius.lg}px`,
  });
}

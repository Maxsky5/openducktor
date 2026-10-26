import type { AppTheme } from "./tokens";

/**
 * Builds plain styles from the theme, once for each theme and key. A view with many variants,
 * such as a badge tone, reads its styles with the theme of `useAppTheme`. It then calls no
 * stylesheet function, which runs native code on each call, and a theme change renders it again
 * with the styles of the new theme.
 */
export const themeStyleCache = <Key, Style, Theme extends object = AppTheme>(
  build: (theme: Theme, key: Key) => Style,
): ((theme: Theme, key: Key) => Style) => {
  const themes = new WeakMap<Theme, Map<Key, Style>>();
  return (theme, key) => {
    let styles = themes.get(theme);
    if (!styles) {
      styles = new Map();
      themes.set(theme, styles);
    }
    let style = styles.get(key);
    if (style === undefined) {
      style = build(theme, key);
      styles.set(key, style);
    }
    return style;
  };
};

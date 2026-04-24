import type { Theme } from "@openducktor/contracts";

const THEME_CLASS_NAMES = ["light", "dark"] as const;

export const readDocumentTheme = (fallback: Theme): Theme => {
  if (typeof document === "undefined") {
    return fallback;
  }

  const root = document.documentElement;
  if (root.classList.contains("dark")) {
    return "dark";
  }
  if (root.classList.contains("light")) {
    return "light";
  }

  return fallback;
};

export const applyThemeToDocument = (theme: Theme): void => {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  root.classList.remove(...THEME_CLASS_NAMES);
  root.classList.add(theme);
};

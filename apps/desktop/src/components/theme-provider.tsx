import { createContext, useContext, useEffect, useState } from "react";
import { createHostClient } from "@/lib/host-client";

type Theme = "dark" | "light";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
  theme: "light",
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

const hostClient = createHostClient();

export function ThemeProvider({
  children,
  defaultTheme = "light",
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme);

  // Load theme from config file on mount
  useEffect(() => {
    hostClient
      .getTheme()
      .then((stored) => {
        const resolved = stored === "dark" ? "dark" : "light";
        setThemeState(resolved);
      })
      .catch(() => {
        // Fallback to default if config unavailable (e.g. outside Tauri runtime)
      });
  }, []);

  // Apply theme class to <html>
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
  }, [theme]);

  const value = {
    theme,
    setTheme: (newTheme: Theme) => {
      setThemeState(newTheme);
      // Persist to config file (fire-and-forget)
      hostClient.setTheme(newTheme).catch(() => {
        // Fallback: at least keep localStorage for non-Tauri envs
        localStorage.setItem("openducktor-ui-theme", newTheme);
      });
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
};

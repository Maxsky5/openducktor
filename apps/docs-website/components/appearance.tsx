"use client";
import { Moon, Sun } from "lucide-react";
import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

type Appearance = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Runs in the head before the first paint, so the page starts with the system appearance. The
 * provider keeps a selection only in memory. A reload starts with the system appearance again.
 */
export const APPEARANCE_SCRIPT = `(()=>{const r=document.documentElement,d=matchMedia(${JSON.stringify(DARK_QUERY)}).matches;r.classList.toggle("dark",d);r.dataset.theme=d?"dark":"light";r.style.colorScheme=d?"dark":"light"})()`;

type AppearanceState = { appearance: Appearance | undefined; select: (value: Appearance) => void };

const AppearanceContext = createContext<AppearanceState | null>(null);

function subscribeSystem(onChange: () => void): () => void {
  const query = matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function systemAppearance(): Appearance {
  return matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

/** Applies one appearance to the page, the navigation, search, and the product demonstrations. */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Appearance | undefined>();
  const system = useSyncExternalStore(subscribeSystem, systemAppearance, () => undefined);
  const appearance = selected ?? system;

  useEffect(() => {
    if (!appearance) return;
    const root = document.documentElement;
    root.classList.toggle("dark", appearance === "dark");
    // The product scenes of the demonstrations select their dark tokens with `data-theme`.
    root.dataset.theme = appearance;
    root.style.colorScheme = appearance;
  }, [appearance]);

  const state = useMemo(() => ({ appearance, select: setSelected }), [appearance]);
  return <AppearanceContext value={state}>{children}</AppearanceContext>;
}

/** The appearance of the page, and the function that selects one. `appearance` is unknown on the server. */
export function useAppearance(): AppearanceState {
  const state = use(AppearanceContext);
  if (!state) throw new Error("Render the appearance switch inside AppearanceProvider.");
  return state;
}

/**
 * The header switch, like the theme button of the website. It needs JavaScript, so the page hides
 * it without scripts. It holds both icons, and the `dark` class of the page root shows one, so the
 * server markup shows the correct icon before the page hydrates.
 */
export function AppearanceSwitch({ className }: { className?: string | undefined }) {
  const { appearance, select } = useAppearance();
  const dark = appearance === "dark";
  return (
    <button
      type="button"
      className={`docs-icon-button docs-appearance-switch ${className ?? ""}`}
      aria-label="Dark appearance"
      aria-pressed={appearance ? dark : undefined}
      onClick={() => select(dark ? "light" : "dark")}
      data-requires-script=""
    >
      <Moon className="docs-appearance-light" aria-hidden="true" />
      <Sun className="docs-appearance-dark" aria-hidden="true" />
    </button>
  );
}

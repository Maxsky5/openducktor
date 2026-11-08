import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { preloadFeatureTourDialog } from "./feature-tour-dialog-loader";

type FeatureTourContextValue = {
  /**
   * Opens the tour at slide 1. On close, focus goes to `returnFocus` unless another open dialog
   * holds the focus.
   */
  openFeatureTour(returnFocus: HTMLElement | null): void;
};

type FeatureTourState = { open: boolean; returnFocus: HTMLElement | null };

type FeatureTourStateValue = FeatureTourState & { close(): void };

const FeatureTourContext = createContext<FeatureTourContextValue | null>(null);
const FeatureTourStateContext = createContext<FeatureTourStateValue | null>(null);

/** Keeps the tour state in client memory only. `ApplicationOverlays` mounts `FeatureTourDialogHost` inside it. */
export function FeatureTourProvider({ children }: PropsWithChildren): ReactElement {
  const [tour, setTour] = useState<FeatureTourState>({ open: false, returnFocus: null });

  const openFeatureTour = useCallback((returnFocus: HTMLElement | null): void => {
    preloadFeatureTourDialog();
    setTour({ open: true, returnFocus });
  }, []);
  const close = useCallback((): void => setTour((current) => ({ ...current, open: false })), []);

  const contextValue = useMemo(() => ({ openFeatureTour }), [openFeatureTour]);
  const stateValue = useMemo(() => ({ ...tour, close }), [tour, close]);

  return (
    <FeatureTourContext.Provider value={contextValue}>
      <FeatureTourStateContext.Provider value={stateValue}>
        {children}
      </FeatureTourStateContext.Provider>
    </FeatureTourContext.Provider>
  );
}

export function useFeatureTour(): FeatureTourContextValue {
  const value = useContext(FeatureTourContext);
  if (!value) throw new Error("useFeatureTour must be used inside FeatureTourProvider.");
  return value;
}

export function useFeatureTourState(): FeatureTourStateValue {
  const value = useContext(FeatureTourStateContext);
  if (!value) throw new Error("useFeatureTourState must be used inside FeatureTourProvider.");
  return value;
}

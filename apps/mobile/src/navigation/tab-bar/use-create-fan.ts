import { useCallback, useState } from "react";
import {
  type SharedValue,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { haptics } from "@/ui/haptics";

const OPEN = { duration: 420, dampingRatio: 0.72 } as const;
const CLOSE = { duration: 160 } as const;

export type CreateFanState = {
  /** 0 while closed, 1 while open. A spring past 1 makes the actions pop. */
  progress: SharedValue<number>;
  open: boolean;
  /** True while the fan shows, also while it closes. */
  menuMounted: boolean;
  close: () => void;
  toggle: () => void;
};

/** The open state of the create fan of the tab bar or the rail, with its spring. */
export const useCreateFan = (): CreateFanState => {
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const [open, setOpen] = useState(false);
  const [menuMounted, setMenuMounted] = useState(false);
  const close = useCallback(() => {
    setOpen(false);
    progress.set(
      withTiming(0, CLOSE, (finished) => {
        if (finished) scheduleOnRN(setMenuMounted, false);
      }),
    );
  }, [progress]);
  const toggle = useCallback(() => {
    if (open) {
      close();
      return;
    }
    haptics.light();
    setMenuMounted(true);
    setOpen(true);
    progress.set(reducedMotion ? withTiming(1, CLOSE) : withSpring(1, OPEN));
  }, [close, open, progress, reducedMotion]);
  return { progress, open, menuMounted, close, toggle };
};

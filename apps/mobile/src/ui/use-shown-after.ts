import { useEffect, useState } from "react";

/**
 * True while `visible`, but only after it stayed true for `delayMs`. A state that ends sooner,
 * such as a quick reconnect, never shows. A zero delay shows at once.
 */
export const useShownAfter = (visible: boolean, delayMs: number): boolean => {
  const [shown, setShown] = useState(visible && delayMs === 0);
  useEffect(() => {
    if (!visible) {
      setShown(false);
      return;
    }
    if (delayMs === 0) {
      setShown(true);
      return;
    }
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, visible]);
  return visible && shown;
};

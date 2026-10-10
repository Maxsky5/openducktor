import { useEffect, useState } from "react";

const NARROW_WINDOW_QUERY = "(max-width: 767px)";

/** Tells if the window is narrow enough that a session panel fills the page. */
export function useNarrowWindow(): boolean {
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(NARROW_WINDOW_QUERY);
    const update = (): void => setIsNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return isNarrow;
}

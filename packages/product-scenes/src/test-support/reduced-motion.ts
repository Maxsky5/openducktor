// Reduced motion for the tests of the players. Production code does not import it.

/**
 * Makes the visitor ask for reduced motion through `motionQuery`, the query that the players read.
 * `restore` puts back the setting. `waiting` holds once a player listens for the reader to accept
 * motion, which its effect does only after the hydration of its view.
 */
export function reduceMotion(motionQuery: string) {
  const matchMedia = window.matchMedia;
  let listeners = 0;
  window.matchMedia = (query) => {
    const asked = query === motionQuery ? "(prefers-reduced-motion: reduce)" : query;
    const list = matchMedia.call(window, asked);
    const add = list.addEventListener.bind(list);
    list.addEventListener = (...args: Parameters<MediaQueryList["addEventListener"]>) => {
      if (query === motionQuery && args[0] === "change") listeners += 1;
      add(...args);
    };
    return list;
  };
  const restore = () => {
    window.matchMedia = matchMedia;
  };
  return { restore, waiting: () => listeners > 0 };
}

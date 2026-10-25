import {
  type ComponentRef,
  createContext,
  type RefObject,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { View } from "react-native";
import { createViewportStore, isNearViewport, type ViewportStore } from "./viewport-model";

const ViewportContext = createContext<ViewportStore | null>(null);

/** Gives the resource views of a list its scroll viewport. */
export const ViewportProvider = ViewportContext;

/**
 * The viewport of one scrolling list. Wrap the list in a view with `frameRef` and
 * `onFrameLayout`, pass `onScroll` to the list, and provide `store` with `ViewportProvider`.
 */
export const useListViewport = () => {
  const [store] = useState(createViewportStore);
  const frameRef = useRef<ComponentRef<typeof View>>(null);
  const onFrameLayout = useCallback(() => {
    frameRef.current?.measureInWindow((_x, y, _width, height) =>
      store.setBounds({ top: y, bottom: y + height }),
    );
  }, [store]);
  return { store, frameRef, onFrameLayout, onScroll: store.notify };
};

export type InViewport = {
  /** True while the gate is open and the view is near the viewport. */
  inView: boolean;
  /** The ref for the view that holds the resource. Its window position decides `inView`. */
  ref: RefObject<ComponentRef<typeof View> | null>;
  /** Pass to the view `onLayout`, so a moved view checks its position again. */
  onLayout: () => void;
};

/**
 * Tells a resource view, such as an image or an isolated page, when it is near the list viewport.
 * `gate` is the visibility of its list row; a closed gate keeps the resource out at once. Outside a
 * list with a viewport, the gate alone decides.
 */
export const useInViewport = (gate: boolean): InViewport => {
  const store = use(ViewportContext);
  const ref = useRef<ComponentRef<typeof View>>(null);
  const [near, setNear] = useState(false);
  const check = useRef<() => void>(() => {});
  useEffect(() => {
    if (!gate || store === null) return;
    let active = true;
    check.current = () => {
      const bounds = store.bounds();
      const view = ref.current;
      if (bounds === null || view === null) return;
      view.measureInWindow((_x, y, _width, height) => {
        if (active) setNear(isNearViewport(y, height, bounds));
      });
    };
    check.current();
    const stop = store.subscribe(() => check.current());
    return () => {
      active = false;
      stop();
      check.current = () => {};
      setNear(false);
    };
  }, [gate, store]);
  const onLayout = useCallback(() => check.current(), []);
  return { inView: gate && (store === null || near), ref, onLayout };
};

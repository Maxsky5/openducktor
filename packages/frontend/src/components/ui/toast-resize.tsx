import { type ReactElement, type ReactNode, useEffectEvent, useLayoutEffect, useRef } from "react";

type ToastResize = {
  hold(): void;
  /** Returns `true` when it starts a new motion. */
  resize(): boolean;
  /** Runs `resize` in the next frame. A later call replaces the pending one. */
  schedule(): void;
  pause(): void;
  stop(): void;
};

type Motion = { duration: number; easing: string };

type Resize = Motion & {
  from: number;
  to: number;
  /** The CSS reversing-adjusted start value. A transition back to it is a reversal. */
  reversesTo: number;
  /** The CSS reversing shortening factor. */
  factor: number;
};

const cssList = (value: string) => value.split(/,(?![^(]*\))/).map((item) => item.trim());

const cssTime = (value: string) =>
  value.endsWith("ms") ? Number.parseFloat(value) : Number.parseFloat(value) * 1000;

const same = (left: number, right: number) => Math.abs(left - right) < 1;

/** A motion that an update stopped, with the height it showed at that moment. */
type HeldResize = { resize: Resize; visible: number; begin: number | null };

/** The CSS reversing shortening factor of a motion that reverses the held one. */
function reversingFactor({ resize, visible }: HeldResize): number {
  const portion = Math.abs(visible - resize.from) / Math.abs(resize.to - resize.from);
  return Math.abs(portion * resize.factor + 1 - resize.factor);
}

/**
 * Reads the transition that Sonner uses to move the other toasts of the stack. It returns `null`
 * when Sonner moves the stack at once, for example with reduced motion.
 */
function stackMotion(toast: HTMLElement): Motion | null {
  const styles = getComputedStyle(toast);
  const index = cssList(styles.transitionProperty).indexOf("transform");
  if (index === -1) return null;
  const at = (values: string[]) => values[index % values.length] ?? "";
  const duration = cssTime(at(cssList(styles.transitionDuration)));
  if (!(duration > 0)) return null;
  return { duration, easing: at(cssList(styles.transitionTimingFunction)) };
}

/**
 * Animates the height of a Sonner toast with the transition that moves the toast stack, so the
 * gap to the other toasts stays the same during the motion.
 *
 * Sonner measures the natural toast height to place the toast stack. Call `hold` before Sonner
 * measures, and `resize` after the layout changes.
 */
function observeToastResize(toast: HTMLElement): ToastResize {
  let height = toast.getBoundingClientRect().height;
  // `begin` is the timeline time of the motion start. A paused motion has none.
  let animation: { resize: Resize; effect: Animation; begin: number | null } | null = null;
  let held: HeldResize | null = null;
  let frame = 0;

  const hold = () => {
    if (!animation) return;
    held = {
      resize: animation.resize,
      visible: toast.getBoundingClientRect().height,
      begin: animation.begin,
    };
    animation.effect.cancel();
    animation = null;
  };

  /** Plays from the start, or from `begin` to continue a motion without losing frames. */
  const play = (resize: Resize, begin: number | null) => {
    // The toast box must follow its content. A transform would stretch the text.
    const effect = toast.animate(
      [
        // react-doctor-disable-next-line react-doctor/no-layout-property-animation
        { height: `${resize.from}px`, overflow: "hidden" },
        // react-doctor-disable-next-line react-doctor/no-layout-property-animation
        { height: `${resize.to}px`, overflow: "hidden" },
      ],
      { duration: resize.duration, easing: resize.easing },
    );
    if (begin !== null) effect.startTime = begin;
    const current = { resize, effect, begin: begin ?? Number(document.timeline.currentTime ?? 0) };
    animation = current;
    effect.onfinish = () => {
      if (animation === current) animation = null;
    };
  };

  const resize = (): boolean => {
    hold();
    const previous = held;
    held = null;
    const to = toast.getBoundingClientRect().height;
    const from = previous ? previous.visible : height;
    height = to;
    if (same(from, to)) return false;
    const motion = stackMotion(toast);
    if (!motion) return false;
    // Follow the CSS transition rules that Sonner's stack offsets use when an update interrupts.
    if (previous && same(previous.resize.to, to)) {
      play(previous.resize, previous.begin);
      return false;
    }
    let factor = 1;
    let reversesTo = from;
    if (previous && same(previous.resize.reversesTo, to)) {
      factor = reversingFactor(previous);
      reversesTo = previous.resize.to;
    }
    play({ ...motion, duration: motion.duration * factor, from, to, reversesTo, factor }, null);
    return true;
  };

  return {
    hold,
    resize,
    schedule: () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resize);
    },
    pause: () => {
      if (!animation) return;
      animation.effect.pause();
      animation.begin = null;
    },
    stop: () => {
      cancelAnimationFrame(frame);
      held = null;
      animation?.effect.cancel();
      animation = null;
    },
  };
}

/**
 * Wraps the content of a Sonner toast and animates the toast to each new height.
 *
 * Sonner measures a toast only when the toast updates. Update the toast from `onResize`, so a
 * change inside the content also moves the toasts above it.
 */
export function ToastResizeContent({
  className,
  children,
  onResize,
}: {
  className?: string;
  children: ReactNode;
  onResize: (height: number) => void;
}): ReactElement {
  const content = useRef<HTMLDivElement>(null);
  const resize = useRef<ToastResize | null>(null);
  const reportResize = useEffectEvent(onResize);
  useLayoutEffect(() => {
    const element = content.current;
    const toast = element?.closest<HTMLElement>("[data-sonner-toast]");
    if (!element || !toast)
      throw new Error("ToastResizeContent must render inside a Sonner toast.");
    const current = observeToastResize(toast);
    resize.current = current;
    const observer = new ResizeObserver(() => {
      // Read before the motion starts, while the layout is still clean.
      const height = element.getBoundingClientRect().height;
      // Sonner moves the stack after the toast update from `onResize`, in the next frame. Keep a
      // new motion at its start until then, so the toast and the stack move together.
      if (current.resize()) {
        current.pause();
        current.schedule();
      }
      reportResize(height);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      current.stop();
      resize.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    // Each toast update makes Sonner measure the toast in a parent layout effect.
    resize.current?.hold();
    resize.current?.schedule();
  });
  return (
    <div ref={content} className={className}>
      {children}
    </div>
  );
}

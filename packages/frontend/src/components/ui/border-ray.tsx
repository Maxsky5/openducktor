import {
  type CSSProperties,
  memo,
  type ReactElement,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BORDER_RAY_DEFAULT_LENGTH_MAX,
  BORDER_RAY_DEFAULT_LENGTH_MIN,
  BORDER_RAY_DEFAULT_LENGTH_RATIO,
  BORDER_RAY_DEFAULT_STROKE_WIDTH,
  BORDER_RAY_DEFAULT_TURN_DURATION_MS,
  type BorderRaySize,
  computeBorderRayGeometry,
  DEFAULT_BORDER_RAY_SIZE,
} from "@/components/ui/border-ray-model";
import { cn } from "@/lib/utils";

type BorderRayProps = {
  className?: string;
  color?: string;
  insetOffset?: number;
  strokeWidth?: number;
  turnDurationMs?: number;
  rayLengthRatio?: number;
  rayLengthMin?: number;
  rayLengthMax?: number;
};

type BorderRayStyle = CSSProperties & { "--odt-border-ray-color"?: string };

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function parseCssLength(
  rawValue: string,
  host: HTMLElement,
  containerWidth: number,
  containerHeight: number,
  fallback: number,
): number {
  const token = rawValue.split(/\s|\//).find((part) => part.length > 0) ?? rawValue;
  const numeric = Number.parseFloat(token);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  if (token.endsWith("rem")) {
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    return numeric * (Number.isFinite(rootFontSize) ? rootFontSize : 16);
  }

  if (token.endsWith("em")) {
    const elementFontSize = Number.parseFloat(getComputedStyle(host).fontSize);
    return numeric * (Number.isFinite(elementFontSize) ? elementFontSize : 16);
  }

  if (token.endsWith("%")) {
    return (Math.min(containerWidth, containerHeight) * numeric) / 100;
  }

  return numeric;
}

function readBorderRaySize(host: HTMLElement): BorderRaySize {
  // The layout size ignores the transforms of the ancestors, so a scaled ancestor keeps the ray
  // on the border.
  const width = Math.max(host.offsetWidth, 1);
  const height = Math.max(host.offsetHeight, 1);
  const style = getComputedStyle(host);
  const radius = Math.max(parseCssLength(style.borderTopLeftRadius, host, width, height, 12), 0);
  const borderWidth = Math.max(parseCssLength(style.borderTopWidth, host, width, height, 1), 0);

  return { width, height, radius, borderWidth };
}

function areBorderRaySizesClose(left: BorderRaySize, right: BorderRaySize): boolean {
  return (
    Math.abs(left.width - right.width) < 0.25 &&
    Math.abs(left.height - right.height) < 0.25 &&
    Math.abs(left.radius - right.radius) < 0.25 &&
    Math.abs(left.borderWidth - right.borderWidth) < 0.1
  );
}

/**
 * A ray that runs around the border of its parent. Each edge band moves one bar with a transform
 * animation, so the ray keeps running while the main thread is busy.
 */
export const BorderRay = memo(function BorderRay({
  className,
  color,
  insetOffset = -1,
  strokeWidth = BORDER_RAY_DEFAULT_STROKE_WIDTH,
  turnDurationMs = BORDER_RAY_DEFAULT_TURN_DURATION_MS,
  rayLengthRatio = BORDER_RAY_DEFAULT_LENGTH_RATIO,
  rayLengthMin = BORDER_RAY_DEFAULT_LENGTH_MIN,
  rayLengthMax = BORDER_RAY_DEFAULT_LENGTH_MAX,
}: BorderRayProps): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const animationsRef = useRef<Animation[]>([]);
  const [size, setSize] = useState<BorderRaySize>(DEFAULT_BORDER_RAY_SIZE);

  useLayoutEffect(() => {
    const host = rootRef.current?.parentElement;
    if (!host) {
      return;
    }
    const updateFromHost = (): void => {
      const nextSize = readBorderRaySize(host);
      setSize((current) => (areBorderRaySizesClose(current, nextSize) ? current : nextSize));
    };
    // Measure before the first paint, so the ray never shows at the default size.
    updateFromHost();
    const observer = new ResizeObserver(updateFromHost);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(
    () =>
      computeBorderRayGeometry(size, {
        insetOffset,
        strokeWidth,
        rayLengthRatio,
        rayLengthMin,
        rayLengthMax,
      }),
    [insetOffset, rayLengthMax, rayLengthMin, rayLengthRatio, size, strokeWidth],
  );

  // The bars share one turn. The animations start before the first paint, so no bar shows at its
  // resting place. A hidden <Activity> runs the cleanup, and the animations pause: a hidden view
  // has no layout box, so the main thread would run them. The next run reuses them.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    if (animationsRef.current.length === 0) {
      animationsRef.current = Array.from(
        root.querySelectorAll<HTMLElement>(".odt-border-ray-bar"),
        (bar) => bar.animate(null, { iterations: Infinity, easing: "linear" }),
      );
    }
    const animations = animationsRef.current;
    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
    const holdStill = (): void => {
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = 0;
      }
    };
    const applyMotion = (): void => {
      if (reducedMotion.matches) {
        holdStill();
        return;
      }
      const turnStart = document.timeline.currentTime;
      for (const animation of animations) {
        animation.play();
        animation.startTime = turnStart;
      }
    };
    applyMotion();
    reducedMotion.addEventListener("change", applyMotion);
    return () => {
      reducedMotion.removeEventListener("change", applyMotion);
      holdStill();
    };
  }, []);

  // A new size changes the path of each bar and keeps its place in the turn.
  useLayoutEffect(() => {
    const duration = Math.max(turnDurationMs, 1);
    animationsRef.current.forEach((animation, index) => {
      // SAFETY: Element.animate creates its animation with a KeyframeEffect.
      const effect = animation.effect as KeyframeEffect;
      effect.setKeyframes(geometry.segments[index]?.keyframes ?? []);
      effect.updateTiming({ duration });
    });
  }, [geometry, turnDurationMs]);

  const rootStyle: BorderRayStyle = {
    left: -geometry.margin,
    top: -geometry.margin,
    width: geometry.width,
    height: geometry.height,
  };
  if (color) {
    rootStyle["--odt-border-ray-color"] = color;
  }

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className={cn("odt-border-ray", className)}
      style={rootStyle}
    >
      {geometry.segments.map((segment) => (
        <div
          key={segment.edge}
          className="odt-border-ray-segment"
          style={{ clipPath: segment.clipPath }}
        >
          <span
            className="odt-border-ray-bar"
            style={{ width: segment.barWidth, height: segment.barHeight }}
          />
        </div>
      ))}
    </div>
  );
});

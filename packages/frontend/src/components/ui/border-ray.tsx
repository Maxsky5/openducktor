import {
  type CSSProperties,
  type ReactElement,
  useCallback,
  useEffect,
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
  computeBorderRayLength,
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
  const rect = host.getBoundingClientRect();
  const width = Math.max(rect.width, 1);
  const height = Math.max(rect.height, 1);
  const radius = Math.max(
    parseCssLength(getComputedStyle(host).borderTopLeftRadius, host, width, height, 12),
    0,
  );
  const borderWidth = Math.max(
    parseCssLength(getComputedStyle(host).borderTopWidth, host, width, height, 1),
    0,
  );

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

export function BorderRay({
  className,
  color,
  insetOffset = -1,
  strokeWidth = BORDER_RAY_DEFAULT_STROKE_WIDTH,
  turnDurationMs = BORDER_RAY_DEFAULT_TURN_DURATION_MS,
  rayLengthRatio = BORDER_RAY_DEFAULT_LENGTH_RATIO,
  rayLengthMin = BORDER_RAY_DEFAULT_LENGTH_MIN,
  rayLengthMax = BORDER_RAY_DEFAULT_LENGTH_MAX,
}: BorderRayProps): ReactElement {
  const hostRef = useRef<HTMLElement | null>(null);
  const [size, setSize] = useState<BorderRaySize>(DEFAULT_BORDER_RAY_SIZE);

  const updateFromHost = useCallback((host: HTMLElement): void => {
    const nextSize = readBorderRaySize(host);
    setSize((current) => (areBorderRaySizesClose(current, nextSize) ? current : nextSize));
  }, []);

  const setSvgNode = useCallback(
    (node: SVGSVGElement | null): void => {
      const host = node?.parentElement ?? null;
      hostRef.current = host instanceof HTMLElement ? host : null;
      if (hostRef.current) {
        updateFromHost(hostRef.current);
      }
    },
    [updateFromHost],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const syncRect = (): void => {
      updateFromHost(host);
    };

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncRect);
      return () => {
        window.removeEventListener("resize", syncRect);
      };
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      updateFromHost(host);
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
    };
  }, [updateFromHost]);

  const measuredSize = size;
  const rayGeometry = useMemo(() => {
    const inset = Math.max(measuredSize.borderWidth / 2, 0.5) + insetOffset;
    const width = Math.max(measuredSize.width, 1);
    const height = Math.max(measuredSize.height, 1);
    const drawWidth = Math.max(width - inset * 2, 1);
    const drawHeight = Math.max(height - inset * 2, 1);
    const radius = Math.max(
      0,
      Math.min(measuredSize.radius - inset, drawWidth / 2, drawHeight / 2),
    );

    const left = inset;
    const top = inset;
    const right = left + drawWidth;
    const bottom = top + drawHeight;

    const path = [
      `M ${left + radius} ${top}`,
      `H ${right - radius}`,
      `A ${radius} ${radius} 0 0 1 ${right} ${top + radius}`,
      `V ${bottom - radius}`,
      `A ${radius} ${radius} 0 0 1 ${right - radius} ${bottom}`,
      `H ${left + radius}`,
      `A ${radius} ${radius} 0 0 1 ${left} ${bottom - radius}`,
      `V ${top + radius}`,
      `A ${radius} ${radius} 0 0 1 ${left + radius} ${top}`,
      "Z",
    ].join(" ");

    const perimeter = Math.max(1, 2 * (drawWidth + drawHeight - 4 * radius) + 2 * Math.PI * radius);
    const rayLength = computeBorderRayLength(perimeter, rayLengthRatio, rayLengthMin, rayLengthMax);

    return {
      path,
      width,
      height,
      perimeter,
      rayLength,
    };
  }, [
    insetOffset,
    measuredSize.borderWidth,
    measuredSize.height,
    measuredSize.radius,
    measuredSize.width,
    rayLengthMax,
    rayLengthMin,
    rayLengthRatio,
  ]);

  const rayStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: 2,
    ["--odt-border-ray-turn-duration" as string]: `${Math.max(turnDurationMs, 1)}ms`,
    ["--odt-border-ray-perimeter" as string]: `${rayGeometry.perimeter}px`,
    ["--odt-border-ray-length" as string]: `${rayGeometry.rayLength}px`,
    ["--odt-border-ray-stroke-width" as string]: `${Math.max(strokeWidth, 0.5)}`,
    ...(color ? { ["--odt-border-ray-color" as string]: color } : {}),
  };

  return (
    <svg
      ref={setSvgNode}
      aria-hidden="true"
      className={cn("odt-border-ray", className)}
      viewBox={`0 0 ${rayGeometry.width} ${rayGeometry.height}`}
      preserveAspectRatio="none"
      style={rayStyle}
    >
      <path className="odt-border-ray-segment" d={rayGeometry.path} />
    </svg>
  );
}

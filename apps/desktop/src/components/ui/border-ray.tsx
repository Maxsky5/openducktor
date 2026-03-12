import { type CSSProperties, type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import {
  BORDER_RAY_DEFAULT_LENGTH_MAX,
  BORDER_RAY_DEFAULT_LENGTH_MIN,
  BORDER_RAY_DEFAULT_LENGTH_RATIO,
  BORDER_RAY_DEFAULT_STROKE_WIDTH,
  BORDER_RAY_DEFAULT_TURN_DURATION_MS,
  type BorderRaySize,
  computeBorderRayLength,
  DEFAULT_BORDER_RAY_PATH_METRICS,
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
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pathRef = useRef<SVGPathElement | null>(null);
  const [size, setSize] = useState<BorderRaySize>(DEFAULT_BORDER_RAY_SIZE);
  const [pathMetrics, setPathMetrics] = useState(DEFAULT_BORDER_RAY_PATH_METRICS);

  useEffect(() => {
    const node = svgRef.current;
    if (!node) {
      return;
    }

    const host = node.parentElement;
    if (!(host instanceof HTMLElement)) {
      return;
    }

    const updateFromRect = (
      nextWidth: number,
      nextHeight: number,
      nextRadius: number,
      nextBorderWidth: number,
    ): void => {
      const safeWidth = Math.max(nextWidth, 1);
      const safeHeight = Math.max(nextHeight, 1);
      const safeRadius = Math.max(nextRadius, 0);
      const safeBorderWidth = Math.max(nextBorderWidth, 0);
      setSize((current) => {
        if (
          Math.abs(current.width - safeWidth) < 0.25 &&
          Math.abs(current.height - safeHeight) < 0.25 &&
          Math.abs(current.radius - safeRadius) < 0.25 &&
          Math.abs(current.borderWidth - safeBorderWidth) < 0.1
        ) {
          return current;
        }
        return {
          width: safeWidth,
          height: safeHeight,
          radius: safeRadius,
          borderWidth: safeBorderWidth,
        };
      });
    };

    const readRadius = (containerWidth: number, containerHeight: number): number => {
      return parseCssLength(
        getComputedStyle(host).borderTopLeftRadius,
        host,
        containerWidth,
        containerHeight,
        12,
      );
    };

    const readBorderWidth = (containerWidth: number, containerHeight: number): number => {
      return parseCssLength(
        getComputedStyle(host).borderTopWidth,
        host,
        containerWidth,
        containerHeight,
        1,
      );
    };

    const syncRect = (): void => {
      const rect = host.getBoundingClientRect();
      updateFromRect(
        rect.width,
        rect.height,
        readRadius(rect.width, rect.height),
        readBorderWidth(rect.width, rect.height),
      );
    };

    syncRect();

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
      updateFromRect(
        entry.contentRect.width,
        entry.contentRect.height,
        readRadius(entry.contentRect.width, entry.contentRect.height),
        readBorderWidth(entry.contentRect.width, entry.contentRect.height),
      );
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
    };
  }, []);

  const rayGeometry = useMemo(() => {
    const inset = Math.max(size.borderWidth / 2, 0.5) + insetOffset;
    const width = Math.max(size.width, 1);
    const height = Math.max(size.height, 1);
    const drawWidth = Math.max(width - inset * 2, 1);
    const drawHeight = Math.max(height - inset * 2, 1);
    const radius = Math.max(0, Math.min(size.radius - inset, drawWidth / 2, drawHeight / 2));

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

    return {
      path,
      width,
      height,
    };
  }, [insetOffset, size.borderWidth, size.height, size.radius, size.width]);

  useEffect(() => {
    if (rayGeometry.path.length === 0) {
      return;
    }

    const pathNode = pathRef.current;
    if (!pathNode) {
      return;
    }

    let perimeter = 0;
    try {
      perimeter = pathNode.getTotalLength();
    } catch {
      return;
    }

    if (!Number.isFinite(perimeter) || perimeter <= 0) {
      return;
    }

    const rayLength = computeBorderRayLength(perimeter, rayLengthRatio, rayLengthMin, rayLengthMax);
    setPathMetrics((current) => {
      if (
        Math.abs(current.perimeter - perimeter) < 0.1 &&
        Math.abs(current.rayLength - rayLength) < 0.1
      ) {
        return current;
      }
      return {
        perimeter,
        rayLength,
      };
    });
  }, [rayGeometry.path, rayLengthMax, rayLengthMin, rayLengthRatio]);

  const rayStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: 2,
    ["--odt-border-ray-turn-duration" as string]: `${Math.max(turnDurationMs, 1)}ms`,
    ["--odt-border-ray-perimeter" as string]: `${pathMetrics.perimeter}`,
    ["--odt-border-ray-length" as string]: `${pathMetrics.rayLength}`,
    ["--odt-border-ray-stroke-width" as string]: `${Math.max(strokeWidth, 0.5)}`,
    ...(color ? { ["--odt-border-ray-color" as string]: color } : {}),
  };

  return (
    <svg
      ref={svgRef}
      aria-hidden="true"
      className={cn("odt-border-ray", className)}
      viewBox={`0 0 ${rayGeometry.width} ${rayGeometry.height}`}
      preserveAspectRatio="none"
      style={rayStyle}
    >
      <path ref={pathRef} className="odt-border-ray-segment" d={rayGeometry.path} />
    </svg>
  );
}

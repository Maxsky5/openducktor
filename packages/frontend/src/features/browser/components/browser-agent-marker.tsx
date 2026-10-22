import type { BrowserAgentMarkerAction } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

export type BrowserAgentMarkerPoint = {
  /** A new key starts a new pulse, also at the same point. */
  key: string;
  action: BrowserAgentMarkerAction;
  /** The point in CSS pixels of the page area. */
  x: number;
  y: number;
};

export type BrowserAgentMarkerProps = {
  marker: BrowserAgentMarkerPoint | null;
};

const ACTION_CLASS_NAMES = {
  click: "bg-sky-400/40",
  hover: "bg-transparent",
  type: "bg-sky-400/25",
} satisfies Record<BrowserAgentMarkerAction, string>;

/**
 * A short pulse where an agent clicks, hovers, or types. It fades out by itself. With reduced
 * motion, it only fades.
 */
export function BrowserAgentMarker({ marker }: BrowserAgentMarkerProps): ReactElement {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {marker ? (
        <span
          key={marker.key}
          data-testid="browser-agent-marker"
          data-action={marker.action}
          className={cn(
            "absolute size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-sky-500 opacity-0 transition-[opacity,scale] duration-700 ease-out starting:opacity-100 motion-safe:scale-150 motion-safe:starting:scale-50 motion-reduce:duration-1000",
            ACTION_CLASS_NAMES[marker.action],
          )}
          style={{ left: marker.x, top: marker.y }}
        />
      ) : null}
    </div>
  );
}

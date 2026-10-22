import type { BrowserBox } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { BROWSER_ANNOTATION_NUMBER_CLASS_NAME } from "@/features/browser-annotations";
import { cn } from "@/lib/utils";

export type BrowserAnnotationMarker = {
  annotationId: string;
  number: number;
  /** The box of the annotated element, or null when the element is not on the page. */
  box: BrowserBox | null;
};

export type BrowserAnnotationMarkersProps = {
  markers: readonly BrowserAnnotationMarker[];
  onSelect: (annotationId: string) => void;
};

/** Half of the marker size, so the marker center sits on the top left corner of the element. */
const MARKER_OFFSET = 10;

/** Numbered markers at the top left corner of each annotated element on the page. */
export function BrowserAnnotationMarkers({
  markers,
  onSelect,
}: BrowserAnnotationMarkersProps): ReactElement {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {markers.map(({ annotationId, number, box }) =>
        box ? (
          <button
            key={annotationId}
            type="button"
            aria-label={`Annotation ${number}`}
            data-annotation-id={annotationId}
            className={cn(
              BROWSER_ANNOTATION_NUMBER_CLASS_NAME,
              "pointer-events-auto absolute cursor-pointer shadow-md ring-2 ring-white outline-none focus-visible:ring-sky-600",
            )}
            style={{
              left: Math.max(0, box.x - MARKER_OFFSET),
              top: Math.max(0, box.y - MARKER_OFFSET),
            }}
            onClick={() => onSelect(annotationId)}
          >
            {number}
          </button>
        ) : null,
      )}
    </div>
  );
}

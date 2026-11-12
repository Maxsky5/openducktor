// The stepped track of the effort and speed fields, as step-track.tsx in apps/mobile/src/ui at
// rest: a rounded shell with a tick at each stop, the fill up to the thumb, and the white thumb
// on the chosen stop. The space over the track holds the label that shows only while the finger
// drags, so it stays empty here. Sources: model-field.tsx and step-track-geometry.ts.
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { flag } from "../flag";
import "./StepSlider.css";

type StepSliderProps = {
  /** The number of stops. */
  stops: number;
  /** The chosen stop, from 0. */
  value: number;
  /** The fill of the effort track, or the quiet fill of Standard speed. */
  fill: "effort" | "standard";
  /** A mark in the thumb, such as the speed icon. */
  mark?: ReactNode;
};

export function StepSlider({ stops, value, fill, mark }: StepSliderProps): ReactElement {
  const place: CSSProperties & { "--slider-at": number } = {
    "--slider-at": stops > 1 ? value / (stops - 1) : 0,
  };
  return (
    <span className="mob-slider" style={place} data-fill={fill}>
      <span className="mob-slider-shell">
        <i className="mob-slider-fill" />
        {Array.from({ length: stops }, (_, index) => {
          const tick: CSSProperties & { "--slider-tick": number } = {
            "--slider-tick": stops > 1 ? index / (stops - 1) : 0,
          };
          return (
            // The stops are a fixed row, so the index is a stable key.
            <i
              key={index}
              className="mob-slider-tick"
              style={tick}
              data-under={flag(index < value)}
            />
          );
        })}
        <span className="mob-slider-thumb">{mark}</span>
      </span>
    </span>
  );
}

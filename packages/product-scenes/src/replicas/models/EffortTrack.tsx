// The effort slider of step-track-slider.tsx: a track pill with one tick for each effort level, the
// blue fill up to the thumb, and the label of the level on a raised shoulder over the thumb. The
// product draws the track and the shoulder as one SVG path. The replica builds them from a pill
// and two shoulder curves around a flat top, with the curves of step-track-geometry.ts, so the
// static markup fits any track width. A hidden copy of the label gives the flat top its width, and
// the label shows over the shoulder, centered on the thumb, as in the product. The curves hold for
// a stop away from the ends of the track, where the product walks the shoulder down the end cap.
import type { CSSProperties, ReactElement } from "react";
import { flag } from "../flag";
import "./EffortTrack.css";

/**
 * The shoulder from its foot on the track to the top of the label, in a 20 by 20 box. The curve
 * comes from the Reasoning Effort component of AICSS, MIT license, as step-track-geometry.ts records.
 */
export const SHOULDER = "M0 20C5.398 20 10.012 16.114 10.93 10.794C11.916 4.577 17.277 0 20 0";

/** The heights of the shortest and the tallest tick, which grow from the first stop to the last. */
const SHORTEST_TICK = 4.5;
const TALLEST_TICK = 9;

type TrackStyle = CSSProperties & { "--at": number; "--span": number; "--stretch": number };
type TickStyle = CSSProperties & { "--f": number; "--h": number };

function Shoulder({ end = false }: { end?: boolean }): ReactElement {
  return (
    <svg className="et-shoulder" data-end={flag(end)} viewBox="0 0 20 21" aria-hidden="true">
      <path className="et-shoulder-fill" d={`${SHOULDER}V21H0Z`} />
      <path className="et-shoulder-line" d={SHOULDER} />
    </svg>
  );
}

export function EffortTrack({
  stops,
  value,
}: {
  /** The effort levels of the model, in order. */
  stops: readonly string[];
  value: string;
}): ReactElement {
  const index = stops.indexOf(value);
  if (index < 0) throw new Error(`The effort track has no level ${value}.`);
  const span = stops.length - 1;
  const style: TrackStyle = { "--at": index / span, "--span": span, "--stretch": 0 };
  return (
    <div className="et" style={style} data-effort-track="">
      <span className="et-pill" />
      <span className="et-bump">
        <Shoulder />
        <span className="et-plateau" data-plateau="">
          <span className="et-sizer" data-effort-size="">
            {value}
          </span>
        </span>
        <Shoulder end />
      </span>
      <span className="et-fill" />
      <span className="et-thumb" data-thumb="" />
      {stops.map((stop, stopIndex) => {
        const tick: TickStyle = {
          "--f": stopIndex / span,
          "--h": SHORTEST_TICK + ((TALLEST_TICK - SHORTEST_TICK) * stopIndex) / span,
        };
        return (
          <span
            className="et-tick"
            style={tick}
            data-tick={stop}
            data-on={flag(stopIndex === index)}
            key={stop}
          />
        );
      })}
      <span className="et-label" data-effort-label="">
        {value}
      </span>
    </div>
  );
}

import type { CSSProperties, ReactElement } from "react";
import { cn } from "@/lib/utils";
import type { Station, WorkflowTrackModel } from "./workflow-track-model";

/** The distance from the center of a ring to the end of a line: the radius and a gap. */
const LINE_GAP = 22;
/** The distance from the center of a mark to the end of a line: shorter at a bare mark. */
const gapOf = (kind: Station["kind"]): number => {
  if (kind === "column") return 10;
  return kind === "end" ? 12 : LINE_GAP;
};
/** The widest space between two stations. A track with fewer stations stays short. */
const MAX_PITCH = "8rem";
/** The widest label at an end of the longest track, so it stays inside the card. */
const END_LABEL_WIDTH = 72;

/**
 * One style on every card, so the tracks compare at the same contrast. The border and the check
 * mark of the card show the selection.
 */
const MARK_CLASS = "border-[1.5px] border-muted-foreground/60 text-foreground";
/**
 * Only an agent step takes a ring, and a step of the user a brighter square of the same weight.
 * The columns are bare grey marks, the column dots and the end check, so the work between them
 * stands out.
 */
const STATION_OUTLINE = {
  column: "",
  agent: "rounded-full",
  person: "size-[30px] rounded-md border-foreground/70",
  end: "border-transparent text-muted-foreground",
} satisfies Record<Station["kind"], string>;

/**
 * The track of a new task: a dot in the first column, a mark for each station, and lines between
 * them. Every track of a list has the same pitch from the left, so the stations line up and the
 * length of a track shows how much a workflow does.
 */
export function WorkflowTrack({
  track,
  slots,
}: {
  track: WorkflowTrackModel;
  /** The station count of the longest track of the list. */
  slots: number;
}): ReactElement {
  const { stations } = track;
  const pitch = `min(${MAX_PITCH}, ${(100 / Math.max(1, slots - 1)).toFixed(4)}%)`;
  const at = (index: number) => `calc(${pitch} * ${index})`;
  const labelStyle = (index: number): CSSProperties => ({
    left: at(index),
    maxWidth:
      index === 0 || index === stations.length - 1
        ? `min(${pitch} - 12px, ${END_LABEL_WIDTH}px)`
        : `calc(${pitch} - 12px)`,
  });
  return (
    // A span: the track sits in the button of its card.
    <span aria-hidden="true" className="relative mx-4 block h-14 min-w-0">
      {stations.slice(1).map((station, index) => {
        const from = gapOf(stations[index]!.kind);
        const to = gapOf(station.kind);
        return (
          <span
            key={`line-${station.key}`}
            // The 1px line centers on the marks, whose center is 16px down.
            className="absolute top-[15.5px] h-px bg-muted-foreground/40"
            style={{
              left: `calc(${at(index)} + ${from}px)`,
              width: `calc(${pitch} - ${from + to}px)`,
            }}
          />
        );
      })}
      {stations.map(({ key, kind, Icon }, index) => (
        <span
          key={key}
          className="absolute top-0 flex size-8 -translate-x-1/2 items-center justify-center"
          style={{ left: at(index) }}
        >
          {Icon ? (
            <span
              className={cn(
                "flex size-8 items-center justify-center",
                MARK_CLASS,
                STATION_OUTLINE[kind],
              )}
            >
              <Icon className="size-4" />
            </span>
          ) : (
            <span className="size-2 rounded-full bg-muted-foreground" />
          )}
        </span>
      ))}
      {stations.map(({ key, label }, index) => (
        <span
          key={`label-${key}`}
          className="absolute top-10 -translate-x-1/2 truncate text-center text-xs leading-4 font-medium text-muted-foreground"
          style={labelStyle(index)}
        >
          {label}
        </span>
      ))}
    </span>
  );
}

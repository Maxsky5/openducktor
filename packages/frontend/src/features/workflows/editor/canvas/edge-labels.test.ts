import { describe, expect, test } from "bun:test";
import { elementKey } from "@openducktor/workflows";
import type { EventEdgeData } from "../model/canvas-graph";
import type { EventSender } from "../model/event-senders";
import {
  edgeLabelText,
  LABEL_MIN_ZOOM,
  nextEventKey,
  selectZoomShowsLabels,
  showsEdgeLabel,
} from "./edge-labels";

const button = (label: string): EventSender => ({ kind: "action", label, key: null });
const line = (data: Partial<EventEdgeData>): EventEdgeData => ({
  kind: "arrow",
  eventIds: ["start"],
  senders: [],
  triggered: false,
  label: null,
  resets: false,
  problem: null,
  sourceLabels: [],
  fromAnyState: false,
  actionId: null,
  sendersByEvent: [],
  labelled: true,
  ...data,
});
const text = (data: Partial<EventEdgeData>) => edgeLabelText(line(data), new Map());

const atZoom = (zoom: number) => selectZoomShowsLabels({ transform: [120, -40, zoom] });

describe("edge labels", () => {
  test("the zoom shows labels from the threshold up, and only a crossing changes the value", () => {
    expect([0.1, LABEL_MIN_ZOOM - 0.01].map(atZoom)).toEqual([false, false]);
    expect([LABEL_MIN_ZOOM, 1.2].map(atZoom)).toEqual([true, true]);
  });

  test("only the edges of the selected event keep their labels at a low zoom", () => {
    expect(showsEdgeLabel(false, "selected")).toBe(true);
    expect(showsEdgeLabel(false, "related")).toBe(false);
    expect(showsEdgeLabel(false, "normal")).toBe(false);
    expect(showsEdgeLabel(false, "dimmed")).toBe(false);
  });

  test("a high zoom shows every label", () => {
    for (const emphasis of ["selected", "related", "normal", "dimmed"] as const)
      expect(showsEdgeLabel(true, emphasis)).toBe(true);
  });
});

describe("edge label text", () => {
  test("one transition names its triggers when they fit, else the first one and a count or alone", () => {
    expect(text({})).toBe("No trigger yet");
    expect(text({ senders: [button("Start triage")], triggered: true })).toBe("Start triage");
    expect(text({ senders: [button("A"), button("B")], triggered: true })).toBe("A or B");
    expect(
      text({
        senders: [button("Start the build"), { kind: "agent", label: "qa", key: null }],
        triggered: true,
      }),
    ).toBe("Start the build or 1 more");
    // A label without room for a count keeps the first trigger. The tooltip names the others.
    expect(
      text({
        senders: [button("Start the implementation again"), button("Retry")],
        triggered: true,
      }),
    ).toBe("Start the implementation again");
  });

  test("a line of several transitions names their triggers when they fit, else their count", () => {
    expect(
      text({ eventIds: ["a", "b"], sendersByEvent: [[button("Approve")], [button("Reject")]] }),
    ).toBe("Approve · Reject");
    expect(
      text({
        eventIds: ["a", "b"],
        sendersByEvent: [[button("Approve the change")], [button("Request more changes")]],
      }),
    ).toBe("2 transitions");
    expect(text({ kind: "loop", eventIds: ["a", "b", "c"], sendersByEvent: [[], [], []] })).toBe(
      "3 loops",
    );
  });

  test("an entry names its transition and its source count", () => {
    expect(text({ kind: "entry", label: "Spec saved", sourceLabels: ["A", "B", "C", "D"] })).toBe(
      "Spec saved · from 4 states",
    );
    expect(
      text({ kind: "entry", label: "Spec saved", sourceLabels: ["A", "B"], fromAnyState: true }),
    ).toBe("Spec saved · from any state");
  });

  test("a transition from many states keeps its sources for the tooltip", () => {
    expect(
      text({ sourceLabels: ["A", "B", "C"], senders: [button("Start")], triggered: true }),
    ).toBe("Start");
  });
});

describe("next event key", () => {
  test("a click selects the first transition, then each next one in turn", () => {
    const ids = ["a", "b", "c"];
    expect(nextEventKey(ids, null)).toBe(elementKey("event", "a"));
    expect(nextEventKey(ids, elementKey("event", "a"))).toBe(elementKey("event", "b"));
    expect(nextEventKey(ids, elementKey("event", "c"))).toBe(elementKey("event", "a"));
    expect(nextEventKey(ids, elementKey("state", "a"))).toBe(elementKey("event", "a"));
  });
});

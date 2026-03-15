import { describe, expect, test } from "bun:test";
import type { RunSummary } from "@openducktor/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RunStateBadge } from "./kanban-task-badges";

const RUN_STATES: Array<{ state: RunSummary["state"]; label: string }> = [
  { state: "starting", label: "Starting" },
  { state: "running", label: "Running" },
  { state: "blocked", label: "Blocked" },
  { state: "awaiting_done_confirmation", label: "Awaiting confirm" },
  { state: "completed", label: "Completed" },
  { state: "failed", label: "Failed" },
  { state: "stopped", label: "Stopped" },
];

describe("RunStateBadge", () => {
  test("renders labels for every supported run state", () => {
    for (const { state, label } of RUN_STATES) {
      const html = renderToStaticMarkup(createElement(RunStateBadge, { runState: state }));
      expect(html).toContain(label);
    }
  });

  test("throws for unknown run states", () => {
    const render = () =>
      renderToStaticMarkup(
        createElement(RunStateBadge, {
          runState: "unexpected" as RunSummary["state"],
        }),
      );

    expect(render).toThrow("Unhandled run state");
  });
});

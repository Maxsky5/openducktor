import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RunStateBadge, type VisibleKanbanRunState } from "./kanban-task-badges";

const RUN_STATES: Array<{ state: VisibleKanbanRunState; label: string }> = [
  { state: "blocked", label: "Blocked" },
  { state: "failed", label: "Failed" },
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
          runState: "unexpected" as VisibleKanbanRunState,
        }),
      );

    expect(render).toThrow("Unhandled run state");
  });
});

import { describe, expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  Tooltip: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  TooltipTrigger: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  TooltipContent: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));

import { TaskIdBadge } from "./task-id-badge";

describe("TaskIdBadge", () => {
  test("renders task ID in monospace font", () => {
    const html = renderToStaticMarkup(createElement(TaskIdBadge, { taskId: "TASK-123" }));

    expect(html).toContain("TASK-123");
    expect(html).toContain("font-mono");
  });

  test("renders copy button with Copy icon", () => {
    const html = renderToStaticMarkup(createElement(TaskIdBadge, { taskId: "TASK-456" }));

    expect(html).toContain('data-testid="copy-task-id"');
  });

  test("applies custom className", () => {
    const html = renderToStaticMarkup(
      createElement(TaskIdBadge, { taskId: "TASK-789", className: "truncate" }),
    );

    expect(html).toContain("truncate");
  });

  test("renders copy button to the left of task ID", () => {
    const html = renderToStaticMarkup(createElement(TaskIdBadge, { taskId: "TASK-ABC" }));

    const copyIndex = html.indexOf('data-testid="copy-task-id"');
    const taskIdIndex = html.indexOf("TASK-ABC");
    expect(copyIndex).toBeLessThan(taskIdIndex);
  });
});

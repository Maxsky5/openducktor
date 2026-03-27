import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildTodoItem } from "./agent-chat-test-fixtures";
import { AgentSessionTodoPanel } from "./agent-session-todo-panel";

const renderPanel = (props: Partial<Parameters<typeof AgentSessionTodoPanel>[0]> = {}) => {
  return renderToStaticMarkup(
    createElement(AgentSessionTodoPanel, {
      todos: [],
      collapsed: true,
      isSessionWorking: false,
      onToggleCollapse: () => {},
      ...props,
    }),
  );
};

describe("AgentSessionTodoPanel", () => {
  test("stays hidden when todos are completed-only or cancelled-only", () => {
    expect(
      renderPanel({
        todos: [buildTodoItem({ status: "completed" })],
      }),
    ).toBe("");

    expect(
      renderPanel({
        todos: [buildTodoItem({ status: "cancelled" })],
      }),
    ).toBe("");
  });

  test("renders collapsed by default with a single truncating actionable summary", () => {
    const html = renderPanel({
      collapsed: true,
      accentColor: "#123456",
      todos: [
        buildTodoItem({ id: "todo-1", content: "Completed work", status: "completed" }),
        buildTodoItem({ id: "todo-2", content: "Current active item", status: "in_progress" }),
        buildTodoItem({ id: "todo-3", content: "Queued item", status: "pending" }),
      ],
    });

    expect(html).toContain("Todo");
    expect(html).toContain("Current active item");
    expect(html).not.toContain("Queued item");
    expect(html).toContain("truncate");
    expect(html).toContain("border-l border-border/70 pl-3");
    expect(html).not.toContain("line-clamp-2");
    expect(html).toContain("w-full rounded-t-xl");
    expect(html).toContain("border-b-0");
    expect(html).toContain("border-l-4");
    expect(html).toContain("border-left-color:#123456");
    expect(html).not.toContain("justify-end");
    expect(html).not.toContain("max-w-md");
  });

  test("falls back to the next pending todo when nothing is in progress", () => {
    const html = renderPanel({
      collapsed: true,
      todos: [
        buildTodoItem({ id: "todo-1", content: "Completed work", status: "completed" }),
        buildTodoItem({ id: "todo-2", content: "Next pending item", status: "pending" }),
      ],
    });

    expect(html).toContain("Next pending item");
  });

  test("uses idle in-progress icon without spinner when session is not working", () => {
    const html = renderPanel({
      collapsed: true,
      isSessionWorking: false,
      todos: [buildTodoItem({ status: "in_progress" })],
    });

    expect(html).toContain("lucide-circle-dot-dashed");
    expect(html).not.toContain("animate-spin");
  });

  test("keeps spinner for in-progress todos while the session is working", () => {
    const html = renderPanel({
      collapsed: true,
      isSessionWorking: true,
      todos: [buildTodoItem({ status: "in_progress" })],
    });

    expect(html).toContain("lucide-loader-circle");
    expect(html).toContain("animate-spin");
  });

  test("renders expanded rows with alignment-friendly structure and completed context", () => {
    const html = renderPanel({
      collapsed: false,
      todos: [
        buildTodoItem({ id: "todo-1", content: "Done item", status: "completed" }),
        buildTodoItem({
          id: "todo-2",
          content: "Active item with a much longer description that should wrap to another line",
          status: "in_progress",
        }),
      ],
    });

    expect(html).toContain("Done item");
    expect(html).toContain("Active item with a much longer description");
    expect(html).toContain("grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-2");
    expect(html).toContain("inline-flex h-5 w-5 shrink-0 items-center justify-center self-start");
    expect(html).toContain("block min-w-0 leading-5");
    expect(html).toContain("font-medium text-foreground");
    expect(html).not.toContain("mt-[3px]");
  });
});

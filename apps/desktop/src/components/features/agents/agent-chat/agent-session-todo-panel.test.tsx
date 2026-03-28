import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { cleanup, render, screen, within } from "@testing-library/react";
import { buildTodoItem } from "./agent-chat-test-fixtures";
import { AgentSessionTodoPanel } from "./agent-session-todo-panel";

const reactActEnvironmentGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const previousActEnvironmentValue = reactActEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT;

beforeAll(() => {
  reactActEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  if (typeof previousActEnvironmentValue === "undefined") {
    delete reactActEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT;
    return;
  }

  reactActEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironmentValue;
});

afterEach(() => {
  cleanup();
});

const renderPanel = (props: Partial<Parameters<typeof AgentSessionTodoPanel>[0]> = {}) => {
  return render(
    <AgentSessionTodoPanel
      todos={[]}
      collapsed
      isSessionWorking={false}
      onToggleCollapse={() => {}}
      {...props}
    />,
  );
};

describe("AgentSessionTodoPanel", () => {
  test("stays hidden when todos are completed-only", () => {
    const completedOnly = renderPanel({
      todos: [buildTodoItem({ status: "completed" })],
    });
    expect(completedOnly.container.innerHTML).toBe("");
  });

  test("stays hidden when todos are cancelled-only", () => {
    const cancelledOnly = renderPanel({
      todos: [buildTodoItem({ status: "cancelled" })],
    });
    expect(cancelledOnly.container.innerHTML).toBe("");
  });

  test("renders collapsed by default with a single actionable summary", () => {
    const { container } = renderPanel({
      collapsed: true,
      accentColor: "#123456",
      todos: [
        buildTodoItem({ id: "todo-1", content: "Completed work", status: "completed" }),
        buildTodoItem({ id: "todo-2", content: "Current active item", status: "in_progress" }),
        buildTodoItem({ id: "todo-3", content: "Queued item", status: "pending" }),
      ],
    });

    const section = screen.getByLabelText("Agent todo list");
    const toggle = screen.getByRole("button", { name: "Expand todo list" });
    const sectionText = section.textContent ?? "";

    expect(sectionText).toContain("Todo");
    expect(sectionText).toContain("1/3");
    expect(sectionText).toContain("Current active item");
    expect(sectionText).not.toContain("Queued item");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    const accentBorder = container.querySelector('[style*="border-left-color"]');
    expect(accentBorder).not.toBeNull();

    expect(screen.queryByRole("list")).toBeNull();
  });

  test("falls back to the next pending todo when nothing is in progress", () => {
    renderPanel({
      collapsed: true,
      todos: [
        buildTodoItem({ id: "todo-1", content: "Completed work", status: "completed" }),
        buildTodoItem({ id: "todo-2", content: "Next pending item", status: "pending" }),
      ],
    });

    expect(screen.getByLabelText("Agent todo list").textContent ?? "").toContain(
      "Next pending item",
    );
  });

  test("uses idle in-progress icon without spinner when session is not working", () => {
    const { container } = renderPanel({
      collapsed: true,
      isSessionWorking: false,
      todos: [buildTodoItem({ status: "in_progress" })],
    });

    expect(container.querySelector(".lucide-circle-dot-dashed")).not.toBeNull();
    expect(container.querySelector(".lucide-loader-circle")).toBeNull();
  });

  test("keeps spinner for in-progress todos while the session is working", () => {
    const { container } = renderPanel({
      collapsed: true,
      isSessionWorking: true,
      todos: [buildTodoItem({ status: "in_progress" })],
    });

    expect(container.querySelector(".lucide-loader-circle")).not.toBeNull();
    expect(container.querySelector(".lucide-circle-dot-dashed")).toBeNull();
  });

  test("renders expanded rows with the full visible todo list", () => {
    renderPanel({
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

    const toggle = screen.getByRole("button", { name: "Collapse todo list" });
    const list = screen.getByRole("list");
    const rows = within(list).getAllByRole("listitem");
    const listText = list.textContent ?? "";

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(rows).toHaveLength(2);
    expect(listText).toContain("Done item");
    expect(listText).toContain("Active item with a much longer description");
  });
});

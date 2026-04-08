import { describe, expect, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import {
  createTaskCardFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { TaskSelector } from "./task-selector";

enableReactActEnvironment();

const tasks: TaskCard[] = [
  createTaskCardFixture({
    id: "TASK-123",
    title: "Polish GPT-5.4 dropdown search",
    issueType: "bug",
    status: "open",
    priority: 1,
    labels: ["frontend", "search"],
  }),
  createTaskCardFixture({
    id: "TASK-999",
    title: "Refine agent studio layout",
    issueType: "feature",
    status: "open",
    priority: 2,
    labels: ["ux"],
  }),
];

describe("TaskSelector", () => {
  test("searches only by task title while keeping the id in the visible label", async () => {
    render(
      <TaskSelector tasks={tasks} value="" includeEmptyOption={false} onValueChange={() => {}} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    const input = screen.getByPlaceholderText("Search tasks...");

    await act(async () => {
      fireEvent.input(input, { target: { value: "TASK-123" } });
    });

    expect(screen.queryByText(/TASK-123/)).toBeNull();

    await act(async () => {
      fireEvent.input(input, { target: { value: "bug" } });
    });

    expect(screen.queryByText(/TASK-123/)).toBeNull();

    await act(async () => {
      fireEvent.input(input, { target: { value: "frontend" } });
    });

    expect(screen.queryByText(/TASK-123/)).toBeNull();

    await act(async () => {
      fireEvent.input(input, { target: { value: "GPT-5.4 dropdown" } });
    });

    expect(screen.getByText("TASK-123 · Polish GPT-5.4 dropdown search")).toBeTruthy();
    expect(screen.queryByText("TASK-999 · Refine agent studio layout")).toBeNull();
  });
});

import { expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { AgentChatComposerSlashMenu } from "./agent-chat-composer-slash-menu";

test("keeps keyboard navigation visible and preserves manual scrolling on unrelated renders", () => {
  const commands = Array.from({ length: 12 }, (_, index) => ({
    id: String(index),
    trigger: `command-${index}`,
    title: `Command ${index}`,
    description: `Description ${index}`,
    hints: [],
  }));
  const menu = (
    activeIndex: number,
    slashCommandsError: string | null = null,
    results = commands,
  ) => (
    <AgentChatComposerSlashMenu
      listboxId="navigation-listbox"
      commands={results}
      activeIndex={activeIndex}
      slashCommandsError={slashCommandsError}
      isSlashCommandsLoading={false}
      onRetry={null}
      onSelectCommand={() => {}}
    />
  );
  const rendered = render(<div>{menu(0)}</div>);
  const ancestor = rendered.container.firstElementChild;
  if (!(ancestor instanceof HTMLElement)) {
    throw new Error("Expected the menu's scrollable ancestor.");
  }
  ancestor.scrollTop = 75;
  const list = screen.getByRole("listbox", { name: "Slash commands" });
  Object.defineProperty(list, "clientHeight", { value: 240 });
  list.getBoundingClientRect = () => new DOMRect(0, 200, 400, 240);
  screen.getAllByRole("option").forEach((row, index) => {
    row.getBoundingClientRect = () => new DOMRect(0, 200 + index * 64 - list.scrollTop, 400, 64);
  });

  list.scrollTop = 384;
  rendered.rerender(<div>{menu(0, "Catalog refresh failed")}</div>);
  expect(screen.getByRole("alert").textContent).toBe("Catalog refresh failed");
  expect(list.scrollTop).toBe(384);
  expect(ancestor.scrollTop).toBe(75);
  rendered.rerender(<div>{menu(0)}</div>);
  expect(list.scrollTop).toBe(384);

  rendered.rerender(<div>{menu(0, null, [...commands])}</div>);
  expect(list.scrollTop).toBe(0);
  expect(ancestor.scrollTop).toBe(75);

  const steps: [number, number][] = [
    [1, 0],
    [4, 80],
    [11, 528],
    [0, 0],
    [11, 528],
    [10, 528],
  ];
  for (const [index, expectedScrollTop] of steps) {
    rendered.rerender(<div>{menu(index)}</div>);
    expect(list.scrollTop).toBe(expectedScrollTop);
    expect(ancestor.scrollTop).toBe(75);
    const selected = screen
      .getAllByRole("option")
      .filter((row) => row.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]?.id).toBe(`navigation-listbox-option-${index}`);
  }
});

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ReactElement, useState } from "react";
import { trackOpenDialog } from "@/components/ui/open-dialogs";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import {
  EMPTY_KANBAN_BOARD_FILTER,
  isKanbanBoardFilterActive,
  type KanbanBoardFilter,
} from "./kanban-board-filter";
import { KanbanBoardFilterBar } from "./kanban-board-filter-bar";

enableReactActEnvironment();

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(globalThis.navigator, "platform");
});

// The search shortcut follows the platform of this device.
const navigatorPlatforms = { darwin: "MacIntel", linux: "Linux x86_64" } as const;

type HarnessProps = {
  initial?: Partial<KanbanBoardFilter>;
  labelOptions?: readonly string[];
  isDisabled?: boolean;
};

const renderBar = ({
  platform = "darwin",
  ...props
}: HarnessProps & { platform?: keyof typeof navigatorPlatforms } = {}) => {
  Object.defineProperty(globalThis.navigator, "platform", {
    configurable: true,
    get: () => navigatorPlatforms[platform],
  });
  const latest = { filter: EMPTY_KANBAN_BOARD_FILTER };
  function Harness({ initial, labelOptions = [], isDisabled = false }: HarnessProps): ReactElement {
    const [value, setValue] = useState<KanbanBoardFilter>({
      ...EMPTY_KANBAN_BOARD_FILTER,
      ...initial,
    });
    latest.filter = value;
    return (
      <KanbanBoardFilterBar
        filter={{
          value,
          labelOptions,
          isActive: isKanbanBoardFilterActive(value),
          isDisabled,
          onChange: (patch) => setValue((current) => ({ ...current, ...patch })),
          onClear: () => setValue(EMPTY_KANBAN_BOARD_FILTER),
        }}
      />
    );
  }
  render(<Harness {...props} />);
  return {
    latest,
    search: screen.getByRole<HTMLInputElement>("textbox", { name: "Search tasks" }),
  };
};

const openMenu = async (name: string): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};

const option = (name: string): HTMLElement => screen.getByRole("option", { name });

describe("KanbanBoardFilterBar search", () => {
  test("updates the search text while the user types and clears only the text with Escape", () => {
    const { latest, search } = renderBar({ initial: { issueTypes: ["bug"] } });

    fireEvent.change(search, { target: { value: "crash" } });
    expect(latest.filter.searchText).toBe("crash");

    fireEvent.keyDown(search, { key: "Escape" });
    expect(latest.filter).toEqual({ ...EMPTY_KANBAN_BOARD_FILTER, issueTypes: ["bug"] });
  });

  for (const [platform, chord] of [
    ["darwin", { metaKey: true }],
    ["linux", { ctrlKey: true }],
  ] as const) {
    test(`moves focus to the search field and selects its text with the ${platform} chord`, () => {
      const { search } = renderBar({ platform, initial: { searchText: "crash" } });

      const isNotPrevented = fireEvent.keyDown(window, { key: "f", ...chord });

      expect(isNotPrevented).toBe(false);
      expect(document.activeElement).toBe(search);
      expect([search.selectionStart, search.selectionEnd]).toEqual([0, "crash".length]);
    });
  }

  test("leaves Mod+F alone with the modifier of the other platform", () => {
    const { search } = renderBar({ platform: "linux" });

    expect(fireEvent.keyDown(window, { key: "f", metaKey: true })).toBe(true);
    expect(document.activeElement).not.toBe(search);
  });

  test("leaves Mod+F alone while a dialog or sheet is open", () => {
    const { search } = renderBar({ platform: "linux" });
    const untrackDialog = trackOpenDialog(Symbol("dialog"));
    try {
      expect(fireEvent.keyDown(window, { key: "f", ctrlKey: true })).toBe(true);
      expect(document.activeElement).not.toBe(search);
    } finally {
      untrackDialog();
    }
  });

  test("disables the controls and leaves Mod+F alone without a workspace", () => {
    const { search } = renderBar({ platform: "linux", isDisabled: true });

    expect(fireEvent.keyDown(window, { key: "f", ctrlKey: true })).toBe(true);
    expect(document.activeElement).not.toBe(search);
    expect(search.hasAttribute("disabled")).toBe(true);
    for (const name of ["Labels", "Type", "Priority"]) {
      expect(screen.getByRole("button", { name }).hasAttribute("disabled")).toBe(true);
    }
  });
});

describe("KanbanBoardFilterBar menus", () => {
  test("keeps the list open, toggles values, and names the selection on the trigger", async () => {
    const { latest } = renderBar();
    await openMenu("Type");
    expect(screen.getByRole("listbox", { name: "Type" })).toBeTruthy();
    expect(screen.getAllByRole("option").map((entry) => entry.textContent)).toEqual([
      "Task",
      "Feature",
      "Bug",
      "Epic",
    ]);

    await act(async () => {
      fireEvent.click(option("Bug"));
    });
    expect(latest.filter.issueTypes).toEqual(["bug"]);
    expect(option("Bug").getAttribute("aria-checked")).toBe("true");
    expect(option("Feature").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("button", { name: "Type: Bug" })).toBeTruthy();

    await act(async () => {
      fireEvent.click(option("Feature"));
    });
    expect(latest.filter.issueTypes).toEqual(["bug", "feature"]);
    expect(screen.getByRole("button", { name: "Type: 2" })).toBeTruthy();

    await act(async () => {
      fireEvent.click(option("Bug"));
    });
    expect(latest.filter.issueTypes).toEqual(["feature"]);
    expect(screen.getByRole("button", { name: "Type: Feature" })).toBeTruthy();
  });

  test("lists the priorities with the words of the card badges", async () => {
    const { latest } = renderBar();
    await openMenu("Priority");

    expect(screen.getAllByRole("option").map((entry) => entry.textContent)).toEqual([
      "P0 Critical",
      "P1 High",
      "P2 Normal",
      "P3 Low",
      "P4 Lowest",
    ]);
    await act(async () => {
      fireEvent.click(option("P4 Lowest"));
    });
    expect(latest.filter.priorities).toEqual([4]);
    expect(screen.getByRole("button", { name: "Priority: P4 Lowest" })).toBeTruthy();
  });

  test("narrows the labels with their text field", async () => {
    const { latest } = renderBar({ labelOptions: ["backend", "bug", "ui"] });
    await openMenu("Labels");

    await act(async () => {
      fireEvent.input(screen.getByPlaceholderText("Search labels"), { target: { value: " B" } });
    });
    expect(screen.getAllByRole("option").map((entry) => entry.textContent)).toEqual([
      "backend",
      "bug",
    ]);

    await act(async () => {
      fireEvent.input(screen.getByPlaceholderText("Search labels"), { target: { value: "zzz" } });
    });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No labels found.")).toBeTruthy();

    await act(async () => {
      fireEvent.input(screen.getByPlaceholderText("Search labels"), { target: { value: "ui" } });
    });
    await act(async () => {
      fireEvent.click(option("ui"));
    });
    expect(latest.filter.labels).toEqual(["ui"]);
  });
});

describe("KanbanBoardFilterBar Clear", () => {
  test("clears the search and every selection, then hides Clear and focuses the search", () => {
    const active = renderBar({
      labelOptions: ["ui"],
      initial: { searchText: "crash", labels: ["ui"], issueTypes: ["bug"], priorities: [0] },
    });
    expect(screen.getByRole("button", { name: "Labels: ui" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(active.latest.filter).toEqual(EMPTY_KANBAN_BOARD_FILTER);
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    expect(document.activeElement).toBe(active.search);
  });
});

import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { Combobox, type ComboboxGroup } from "./combobox";

enableReactActEnvironment();

const createGroupedOptions = (): ComboboxGroup[] => [
  {
    label: "OpenAI",
    options: [
      {
        value: "openai/gpt-5.2",
        label: "GPT-5.2",
        searchKeywords: ["openai", "gpt-5.2", "128k context"],
      },
      {
        value: "openai/gpt-5.4",
        label: "GPT-5.4",
        searchKeywords: ["openai", "gpt-5.4", "256k context"],
      },
    ],
  },
  {
    label: "Anthropic",
    options: [
      {
        value: "anthropic/claude-sonnet-4",
        label: "Claude Sonnet 4",
        searchKeywords: ["anthropic", "claude-sonnet-4", "200k context"],
      },
    ],
  },
];

describe("Combobox", () => {
  test("uses all-terms substring matching, trims whitespace, and drops empty groups", async () => {
    const groupedOptions = createGroupedOptions();

    render(
      <Combobox
        value=""
        options={groupedOptions.flatMap((group) => group.options)}
        groups={groupedOptions}
        matchAllSearchTerms
        onValueChange={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    const input = screen.getByPlaceholderText("Search...");

    await act(async () => {
      fireEvent.input(input, { target: { value: "  GPT-5.4  " } });
    });

    expect(screen.getByText("GPT-5.4")).toBeTruthy();
    expect(screen.queryByText("GPT-5.2")).toBeNull();

    await act(async () => {
      fireEvent.input(input, { target: { value: " openai   5.4 " } });
    });

    expect(screen.getByText("GPT-5.4")).toBeTruthy();
    expect(screen.queryByText("GPT-5.2")).toBeNull();
    expect(screen.queryByText("Claude Sonnet 4")).toBeNull();
    expect(screen.getByText("OpenAI")).toBeTruthy();
    expect(screen.queryByText("Anthropic")).toBeNull();
  });

  test("shows the empty state when all-terms filtering finds no matches", async () => {
    const groupedOptions = createGroupedOptions();

    render(
      <Combobox
        value=""
        options={groupedOptions.flatMap((group) => group.options)}
        groups={groupedOptions}
        matchAllSearchTerms
        emptyText="Nothing found."
        onValueChange={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    await act(async () => {
      fireEvent.input(screen.getByPlaceholderText("Search..."), {
        target: { value: "missing-model" },
      });
    });

    expect(screen.getByText("Nothing found.")).toBeTruthy();
    expect(screen.queryByText("GPT-5.4")).toBeNull();
  });

  test("uses searchText in the default cmdk filtering mode", async () => {
    render(
      <Combobox
        value=""
        options={[
          {
            value: "task-123",
            label: "TASK-123",
            searchText: "Polish GPT-5.4 dropdown search",
          },
        ]}
        onValueChange={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    await act(async () => {
      fireEvent.input(screen.getByPlaceholderText("Search..."), {
        target: { value: "GPT-5.4 dropdown" },
      });
    });

    expect(screen.getByText("TASK-123")).toBeTruthy();
  });

  test("resets the result list scroll to the top when the query changes", async () => {
    const manyOptions = Array.from({ length: 40 }, (_, index) => ({
      value: `option-${index}`,
      label: `Model ${index}`,
      searchKeywords: [index === 39 ? "target" : `group-${index % 4}`],
    }));

    const { container } = render(
      <Combobox value="" options={manyOptions} matchAllSearchTerms onValueChange={() => {}} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    const list = container.ownerDocument.querySelector<HTMLElement>("[data-slot='command-list']");
    if (!list) {
      throw new Error("Expected command list");
    }

    list.scrollTop = 120;

    await act(async () => {
      fireEvent.input(screen.getByPlaceholderText("Search..."), { target: { value: "target" } });
    });

    expect(list.scrollTop).toBe(0);
  });
});

import { describe, expect, mock, test } from "bun:test";
import type { AgentFileSearchResult, AgentSubagentReference } from "@openducktor/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { AgentChatComposerReferenceMenu } from "./agent-chat-composer-reference-menu";
import type { ReferenceMenuItem } from "./use-agent-chat-composer-editor-autocomplete";

const RESULTS: AgentFileSearchResult[] = [
  {
    id: "composer",
    path: "src/agent-chat-composer.tsx",
    name: "agent-chat-composer.tsx",
    kind: "code",
  },
  {
    id: "styles",
    path: "src/styles.css",
    name: "styles.css",
    kind: "css",
  },
];

const SUBAGENTS: AgentSubagentReference[] = [
  {
    id: "reviewer",
    name: "reviewer",
    label: "Reviewer",
  },
];

const LISTBOX_ID = "reference-listbox";

const fileItems = (results: AgentFileSearchResult[]): ReferenceMenuItem[] =>
  results.map((result) => ({
    kind: "file",
    id: `file:${result.id}`,
    result,
  }));

const subagentItems = (subagents: AgentSubagentReference[]): ReferenceMenuItem[] =>
  subagents.map((subagent) => ({
    kind: "subagent",
    id: `subagent:${subagent.id}`,
    subagent,
  }));

describe("AgentChatComposerReferenceMenu", () => {
  test("does not render an empty shell while file search is pending but hidden", () => {
    const rendered = render(
      <AgentChatComposerReferenceMenu
        listboxId={LISTBOX_ID}
        items={[]}
        activeIndex={0}
        fileSearchError={null}
        isFileSearchPending={true}
        isFileSearchLoading={false}
        supportsSubagentReferences={false}
        subagentsError={null}
        isSubagentsLoading={false}
        onSelectFile={() => {}}
        onSelectSubagent={() => {}}
      />,
    );

    expect(rendered.container.firstChild).toBeNull();
  });

  test("renders delayed file search loading inside the reference menu", () => {
    render(
      <AgentChatComposerReferenceMenu
        listboxId={LISTBOX_ID}
        items={[]}
        activeIndex={0}
        fileSearchError={null}
        isFileSearchPending={true}
        isFileSearchLoading={true}
        supportsSubagentReferences={false}
        subagentsError={null}
        isSubagentsLoading={false}
        onSelectFile={() => {}}
        onSelectSubagent={() => {}}
      />,
    );

    const listbox = screen.getByRole("listbox", { name: "References" });

    const loadingFeedback = screen.getByText("Searching files");
    expect(listbox.id).toBe(LISTBOX_ID);
    expect(listbox.contains(loadingFeedback)).toBe(false);
  });

  test("does not render delayed file search loading when results are already visible", () => {
    render(
      <AgentChatComposerReferenceMenu
        listboxId={LISTBOX_ID}
        items={fileItems(RESULTS)}
        activeIndex={0}
        fileSearchError={null}
        isFileSearchPending={true}
        isFileSearchLoading={true}
        supportsSubagentReferences={false}
        subagentsError={null}
        isSubagentsLoading={false}
        onSelectFile={() => {}}
        onSelectSubagent={() => {}}
      />,
    );

    expect(screen.queryByText("Searching files")).toBeNull();
    expect(screen.getByRole("option", { name: /agent-chat-composer\.tsx/i })).toBeDefined();
  });

  test("does not render subagent loading when results are already visible", () => {
    render(
      <AgentChatComposerReferenceMenu
        listboxId={LISTBOX_ID}
        items={fileItems(RESULTS)}
        activeIndex={0}
        fileSearchError={null}
        isFileSearchPending={false}
        isFileSearchLoading={false}
        supportsSubagentReferences={true}
        subagentsError={null}
        isSubagentsLoading={true}
        onSelectFile={() => {}}
        onSelectSubagent={() => {}}
      />,
    );

    expect(screen.queryByText("Loading subagents")).toBeNull();
    expect(screen.getByRole("option", { name: /agent-chat-composer\.tsx/i })).toBeDefined();
  });

  test("uses the selected surface token for the active file row", () => {
    render(
      <AgentChatComposerReferenceMenu
        listboxId={LISTBOX_ID}
        items={fileItems(RESULTS)}
        activeIndex={1}
        fileSearchError={null}
        isFileSearchPending={false}
        isFileSearchLoading={false}
        supportsSubagentReferences={false}
        subagentsError={null}
        isSubagentsLoading={false}
        onSelectFile={() => {}}
        onSelectSubagent={() => {}}
      />,
    );

    const listbox = screen.getByRole("listbox", { name: "References" });
    const activeFile = screen.getByRole("option", { name: /styles\.css/i });
    const inactiveFile = screen.getByRole("option", { name: /agent-chat-composer\.tsx/i });

    expect(activeFile.className).toContain("bg-selected-surface");
    expect(activeFile.className).not.toContain("bg-primary/20");
    expect(activeFile.id).toBe(`${LISTBOX_ID}-option-1`);
    expect(activeFile.getAttribute("aria-selected")).toBe("true");
    expect(activeFile.getAttribute("tabindex")).toBe("-1");
    expect(inactiveFile.getAttribute("aria-selected")).toBe("false");
    expect(listbox.id).toBe(LISTBOX_ID);
    expect(listbox.getAttribute("aria-activedescendant")).toBeNull();
    expect(listbox.getAttribute("tabindex")).toBeNull();
  });

  test("scrolls active subagent and file rows into view as selection changes", () => {
    const scrollIntoView = mock(() => {});
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    const items = [...subagentItems(SUBAGENTS), ...fileItems(RESULTS)];

    try {
      const rendered = render(
        <AgentChatComposerReferenceMenu
          listboxId={LISTBOX_ID}
          items={items}
          activeIndex={0}
          fileSearchError={null}
          isFileSearchPending={false}
          isFileSearchLoading={false}
          supportsSubagentReferences={true}
          subagentsError={null}
          isSubagentsLoading={false}
          onSelectFile={() => {}}
          onSelectSubagent={() => {}}
        />,
      );

      rendered.rerender(
        <AgentChatComposerReferenceMenu
          listboxId={LISTBOX_ID}
          items={items}
          activeIndex={1}
          fileSearchError={null}
          isFileSearchPending={false}
          isFileSearchLoading={false}
          supportsSubagentReferences={true}
          subagentsError={null}
          isSubagentsLoading={false}
          onSelectFile={() => {}}
          onSelectSubagent={() => {}}
        />,
      );

      expect(scrollIntoView).toHaveBeenCalledTimes(2);
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest", inline: "nearest" });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  test("selects subagent and file rows on pointer down", () => {
    const onSelectFile = mock(() => {});
    const onSelectSubagent = mock(() => {});

    render(
      <AgentChatComposerReferenceMenu
        listboxId={LISTBOX_ID}
        items={[...subagentItems(SUBAGENTS), ...fileItems(RESULTS)]}
        activeIndex={0}
        fileSearchError={null}
        isFileSearchPending={false}
        isFileSearchLoading={false}
        supportsSubagentReferences={true}
        subagentsError={null}
        isSubagentsLoading={false}
        onSelectFile={onSelectFile}
        onSelectSubagent={onSelectSubagent}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("option", { name: /@reviewer/i }));
    fireEvent.pointerDown(screen.getByRole("option", { name: /agent-chat-composer\.tsx/i }));

    expect(onSelectSubagent).toHaveBeenCalledWith(SUBAGENTS[0]);
    expect(onSelectFile).toHaveBeenCalledWith(RESULTS[0]);
  });

  test("uses the selected surface token for the active subagent row", () => {
    render(
      <AgentChatComposerReferenceMenu
        listboxId={LISTBOX_ID}
        items={[...subagentItems(SUBAGENTS), ...fileItems(RESULTS)]}
        activeIndex={0}
        fileSearchError={null}
        isFileSearchPending={false}
        isFileSearchLoading={false}
        supportsSubagentReferences={true}
        subagentsError={null}
        isSubagentsLoading={false}
        onSelectFile={() => {}}
        onSelectSubagent={() => {}}
      />,
    );

    const listbox = screen.getByRole("listbox", { name: "References" });
    const activeSubagent = screen.getByRole("option", { name: /@reviewer/i });

    expect(activeSubagent.className).toContain("bg-selected-surface");
    expect(activeSubagent.querySelector(".lucide-bot")).toBeDefined();
    expect(activeSubagent.id).toBe(`${LISTBOX_ID}-option-0`);
    expect(activeSubagent.getAttribute("aria-selected")).toBe("true");
    expect(activeSubagent.getAttribute("tabindex")).toBe("-1");
    expect(listbox.getAttribute("aria-activedescendant")).toBeNull();
    expect(listbox.getAttribute("tabindex")).toBeNull();
  });

  test("mounts a controlled listbox for visible error feedback", () => {
    render(
      <AgentChatComposerReferenceMenu
        listboxId={LISTBOX_ID}
        items={[]}
        activeIndex={0}
        fileSearchError="File search unavailable."
        isFileSearchPending={false}
        isFileSearchLoading={false}
        supportsSubagentReferences={false}
        subagentsError={null}
        isSubagentsLoading={false}
        onSelectFile={() => {}}
        onSelectSubagent={() => {}}
      />,
    );

    const listbox = screen.getByRole("listbox", { name: "References" });
    const errorFeedback = screen.getByText("File search unavailable.");
    expect(listbox.id).toBe(LISTBOX_ID);
    expect(listbox.contains(errorFeedback)).toBe(false);
  });

  test("mounts a controlled listbox for the visible empty state", () => {
    render(
      <AgentChatComposerReferenceMenu
        listboxId={LISTBOX_ID}
        items={[]}
        activeIndex={0}
        fileSearchError={null}
        isFileSearchPending={false}
        isFileSearchLoading={false}
        supportsSubagentReferences={false}
        subagentsError={null}
        isSubagentsLoading={false}
        onSelectFile={() => {}}
        onSelectSubagent={() => {}}
      />,
    );

    const listbox = screen.getByRole("listbox", { name: "References" });
    const emptyFeedback = screen.getByText("No files found.");
    expect(listbox.id).toBe(LISTBOX_ID);
    expect(listbox.contains(emptyFeedback)).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import type { AgentFileSearchResult, AgentSubagentReference } from "@openducktor/core";
import { render, screen } from "@testing-library/react";
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
  test("uses the selected surface token for the active file row", () => {
    render(
      <AgentChatComposerReferenceMenu
        items={fileItems(RESULTS)}
        activeIndex={1}
        fileSearchError={null}
        isFileSearchLoading={false}
        supportsSubagentReferences={false}
        subagentsError={null}
        isSubagentsLoading={false}
        onSelectFile={() => {}}
        onSelectSubagent={() => {}}
      />,
    );

    const activeFile = screen.getByRole("button", { name: /styles\.css/i });

    expect(activeFile.className).toContain("bg-selected-surface");
    expect(activeFile.className).not.toContain("bg-primary/20");
  });

  test("uses the selected surface token for the active subagent row", () => {
    render(
      <AgentChatComposerReferenceMenu
        items={[...subagentItems(SUBAGENTS), ...fileItems(RESULTS)]}
        activeIndex={0}
        fileSearchError={null}
        isFileSearchLoading={false}
        supportsSubagentReferences={true}
        subagentsError={null}
        isSubagentsLoading={false}
        onSelectFile={() => {}}
        onSelectSubagent={() => {}}
      />,
    );

    const activeSubagent = screen.getByRole("button", { name: /@reviewer/i });

    expect(activeSubagent.className).toContain("bg-selected-surface");
    expect(activeSubagent.querySelector(".lucide-bot")).toBeDefined();
  });
});

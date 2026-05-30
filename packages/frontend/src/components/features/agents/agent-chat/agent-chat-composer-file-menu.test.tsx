import { describe, expect, test } from "bun:test";
import type { AgentFileSearchResult } from "@openducktor/core";
import { render, screen } from "@testing-library/react";
import { AgentChatComposerFileMenu } from "./agent-chat-composer-file-menu";

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

describe("AgentChatComposerFileMenu", () => {
  test("uses the selected surface token for the active file row", () => {
    render(
      <AgentChatComposerFileMenu
        results={RESULTS}
        activeIndex={1}
        fileSearchError={null}
        isFileSearchLoading={false}
        onSelectFile={() => {}}
      />,
    );

    const activeFile = screen.getByRole("button", { name: /styles\.css/i });

    expect(activeFile.className).toContain("bg-selected-surface");
    expect(activeFile.className).not.toContain("bg-primary/20");
  });
});

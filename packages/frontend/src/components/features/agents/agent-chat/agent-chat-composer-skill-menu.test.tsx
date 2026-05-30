import { describe, expect, test } from "bun:test";
import type { AgentSkillReference } from "@openducktor/core";
import { render, screen } from "@testing-library/react";
import { AgentChatComposerSkillMenu } from "./agent-chat-composer-skill-menu";

const SKILLS: AgentSkillReference[] = [
  {
    id: "review",
    name: "review",
    path: "/repo/.codex/skills/review/SKILL.md",
    displayName: "Review current changes",
    description: "Inspect the local diff.",
  },
  {
    id: "deslop",
    name: "deslop",
    path: "/repo/.codex/skills/deslop/SKILL.md",
    displayName: "Clean up code",
  },
];

describe("AgentChatComposerSkillMenu", () => {
  test("uses the selected surface token for the active skill row", () => {
    render(
      <AgentChatComposerSkillMenu
        skills={SKILLS}
        activeIndex={0}
        skillsError={null}
        isSkillsLoading={false}
        onSelectSkill={() => {}}
      />,
    );

    const activeSkill = screen.getByRole("button", { name: /review current changes/i });

    expect(activeSkill.className).toContain("bg-selected-surface");
    expect(activeSkill.className).not.toContain("bg-primary/20");
  });
});

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

const LISTBOX_ID = "skill-listbox";

describe("AgentChatComposerSkillMenu", () => {
  test("uses the selected surface token for the active skill row", () => {
    render(
      <AgentChatComposerSkillMenu
        listboxId={LISTBOX_ID}
        skills={SKILLS}
        activeIndex={0}
        skillsError={null}
        isSkillsLoading={false}
        onSelectSkill={() => {}}
      />,
    );

    const listbox = screen.getByRole("listbox", { name: "Skills" });
    const activeSkill = screen.getByRole("option", { name: /review current changes/i });

    expect(listbox.id).toBe(LISTBOX_ID);
    expect(activeSkill.className).toContain("bg-selected-surface");
    expect(activeSkill.className).not.toContain("bg-primary/20");
    expect(activeSkill.id).toBe(`${LISTBOX_ID}-option-0`);
    expect(activeSkill.getAttribute("aria-selected")).toBe("true");
    expect(activeSkill.getAttribute("tabindex")).toBe("-1");
  });
});

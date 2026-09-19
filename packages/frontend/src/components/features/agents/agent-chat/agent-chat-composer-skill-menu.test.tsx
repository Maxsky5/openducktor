import { describe, expect, mock, test } from "bun:test";
import type { AgentSkillReference } from "@openducktor/core";
import { fireEvent, render, screen } from "@testing-library/react";
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
        onRetry={null}
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

  test("scrolls the active skill into view when keyboard navigation changes selection", () => {
    const scrollIntoView = mock(() => {});
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    try {
      const rendered = render(
        <AgentChatComposerSkillMenu
          listboxId={LISTBOX_ID}
          skills={SKILLS}
          activeIndex={0}
          skillsError={null}
          isSkillsLoading={false}
          onRetry={null}
          onSelectSkill={() => {}}
        />,
      );

      rendered.rerender(
        <AgentChatComposerSkillMenu
          listboxId={LISTBOX_ID}
          skills={SKILLS}
          activeIndex={1}
          skillsError={null}
          isSkillsLoading={false}
          onRetry={null}
          onSelectSkill={() => {}}
        />,
      );

      expect(scrollIntoView).toHaveBeenCalledTimes(2);
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest", inline: "nearest" });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  test("mounts the controlled listbox while skills are loading", () => {
    render(
      <AgentChatComposerSkillMenu
        listboxId={LISTBOX_ID}
        skills={[]}
        activeIndex={0}
        skillsError={null}
        isSkillsLoading={true}
        onRetry={null}
        onSelectSkill={() => {}}
      />,
    );

    const listbox = screen.getByRole("listbox", { name: "Skills" });
    const loadingFeedback = screen.getByRole("status");
    expect(listbox.id).toBe(LISTBOX_ID);
    expect(listbox.getAttribute("aria-busy")).toBe("true");
    expect(listbox.contains(loadingFeedback)).toBe(false);
    expect(loadingFeedback.textContent).toBe("Loading skills");
  });

  test("mounts the controlled listbox for skill errors", () => {
    render(
      <AgentChatComposerSkillMenu
        listboxId={LISTBOX_ID}
        skills={[]}
        activeIndex={0}
        skillsError="Skills unavailable"
        isSkillsLoading={false}
        onRetry={null}
        onSelectSkill={() => {}}
      />,
    );

    const listbox = screen.getByRole("listbox", { name: "Skills" });
    const errorFeedback = screen.getByRole("alert");
    expect(listbox.id).toBe(LISTBOX_ID);
    expect(listbox.getAttribute("aria-busy")).toBeNull();
    expect(listbox.contains(errorFeedback)).toBe(false);
    expect(errorFeedback.textContent).toBe("Skills unavailable");
  });

  test("retries a failed skill surface from the error row", () => {
    const onRetry = mock(() => {});
    render(
      <AgentChatComposerSkillMenu
        listboxId={LISTBOX_ID}
        skills={[]}
        activeIndex={0}
        skillsError="Skills unavailable"
        isSkillsLoading={false}
        onRetry={onRetry}
        onSelectSkill={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("omits the retry button when the surface cannot retry", () => {
    render(
      <AgentChatComposerSkillMenu
        listboxId={LISTBOX_ID}
        skills={[]}
        activeIndex={0}
        skillsError="Skills unavailable"
        isSkillsLoading={false}
        onRetry={null}
        onSelectSkill={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  test("mounts the controlled listbox for the empty skill state", () => {
    render(
      <AgentChatComposerSkillMenu
        listboxId={LISTBOX_ID}
        skills={[]}
        activeIndex={0}
        skillsError={null}
        isSkillsLoading={false}
        onRetry={null}
        onSelectSkill={() => {}}
      />,
    );

    const listbox = screen.getByRole("listbox", { name: "Skills" });
    const emptyFeedback = screen.getByRole("status");
    expect(listbox.id).toBe(LISTBOX_ID);
    expect(listbox.contains(emptyFeedback)).toBe(false);
    expect(emptyFeedback.textContent).toBe("No skills found.");
  });
});

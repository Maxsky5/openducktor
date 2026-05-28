import { describe, expect, test } from "bun:test";
import { toCodexSkillCatalog } from "./skill-catalog";

describe("Codex skill catalog mapping", () => {
  test("maps enabled skills and filters disabled skills", () => {
    expect(
      toCodexSkillCatalog({
        data: [
          {
            cwd: "/repo",
            skills: [
              {
                name: "zeta",
                path: "/skills/zeta/SKILL.md",
                title: "Zeta",
                description: "Zeta skill",
                scope: "repo",
              },
              {
                name: "disabled",
                path: "/skills/disabled/SKILL.md",
                enabled: false,
              },
              {
                name: "alpha",
                path: "/user-skills/alpha/SKILL.md",
                description: "Alpha skill",
              },
            ],
          },
        ],
        errors: [],
      }),
    ).toEqual({
      skills: [
        {
          id: "/user-skills/alpha/SKILL.md",
          name: "alpha",
          path: "/user-skills/alpha/SKILL.md",
          title: undefined,
          displayName: undefined,
          description: "Alpha skill",
        },
        {
          id: "/skills/zeta/SKILL.md",
          name: "zeta",
          path: "/skills/zeta/SKILL.md",
          title: "Zeta",
          displayName: undefined,
          description: "Zeta skill",
        },
      ],
    });
  });

  test("rejects malformed and duplicate skill payloads", () => {
    expect(() => toCodexSkillCatalog([{ cwd: "/repo", skills: [] }])).toThrow(
      "Invalid Codex skills/list payload: expected an object with data array.",
    );
    expect(() => toCodexSkillCatalog({ data: [{ cwd: "/repo" }] })).toThrow(
      "Invalid Codex skills/list payload at catalog index 0: missing skills array.",
    );
    expect(() =>
      toCodexSkillCatalog({ data: [{ cwd: "/repo", skills: [{ name: "review" }] }] }),
    ).toThrow("Invalid Codex skill payload: missing path.");
    expect(() =>
      toCodexSkillCatalog({
        data: [
          {
            cwd: "/repo",
            skills: [{ name: "review", path: "/skills/review/SKILL.md", enabled: "false" }],
          },
        ],
      }),
    ).toThrow("Invalid Codex skill payload: enabled must be a boolean.");
    expect(() =>
      toCodexSkillCatalog({
        data: [
          {
            cwd: "/repo",
            skills: [
              { name: "review", path: "/skills/review/SKILL.md" },
              { name: "duplicate-review", path: "/skills/review/SKILL.md" },
            ],
          },
        ],
      }),
    ).toThrow("Duplicate skill id: /skills/review/SKILL.md");
  });
});

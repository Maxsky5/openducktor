import { describe, expect, test } from "bun:test";
import { parseCodexAppServerRequestResult } from "@openducktor/contracts";
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
    expect(() =>
      parseCodexAppServerRequestResult("skills/list", [{ cwd: "/repo", skills: [] }]),
    ).toThrow();
    expect(() =>
      parseCodexAppServerRequestResult("skills/list", {
        data: [{ cwd: "/repo" }],
      }),
    ).toThrow();
    expect(() =>
      parseCodexAppServerRequestResult("skills/list", {
        data: [{ cwd: "/repo", skills: [{ name: "review" }] }],
      }),
    ).toThrow();
    expect(() =>
      parseCodexAppServerRequestResult("skills/list", {
        data: [
          {
            cwd: "/repo",
            skills: [{ name: "review", path: "/skills/review/SKILL.md", enabled: "false" }],
          },
        ],
      }),
    ).toThrow();
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

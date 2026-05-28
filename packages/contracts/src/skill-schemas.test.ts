import { describe, expect, test } from "bun:test";
import { skillCatalogSchema } from "./skill-schemas";

describe("skill schemas", () => {
  test("allows duplicate skill names when stable ids differ", () => {
    expect(
      skillCatalogSchema
        .parse({
          skills: [
            {
              id: "/repo/skills/review/SKILL.md",
              name: "review",
              path: "/repo/skills/review/SKILL.md",
            },
            {
              id: "/user/skills/review/SKILL.md",
              name: "review",
              path: "/user/skills/review/SKILL.md",
            },
          ],
        })
        .skills.map((skill) => skill.id),
    ).toEqual(["/repo/skills/review/SKILL.md", "/user/skills/review/SKILL.md"]);
  });

  test("rejects duplicate stable skill ids", () => {
    expect(() =>
      skillCatalogSchema.parse({
        skills: [
          {
            id: "/repo/skills/review/SKILL.md",
            name: "review",
            path: "/repo/skills/review/SKILL.md",
          },
          {
            id: "/repo/skills/review/SKILL.md",
            name: "review-copy",
            path: "/other/skills/review/SKILL.md",
          },
        ],
      }),
    ).toThrow("Duplicate skill id: /repo/skills/review/SKILL.md");
  });
});

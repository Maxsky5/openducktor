import { describe, expect, test } from "bun:test";
import { subagentCatalogSchema } from "./subagent-schemas";

describe("subagent schemas", () => {
  test("parses visible subagent descriptors", () => {
    const parsed = subagentCatalogSchema.parse({
      subagents: [
        {
          id: " reviewer ",
          name: " reviewer ",
          label: " Review Agent ",
          description: " Checks changes ",
        },
      ],
    });

    expect(parsed.subagents).toEqual([
      {
        id: "reviewer",
        name: "reviewer",
        label: "Review Agent",
        description: "Checks changes",
      },
    ]);
  });

  test("allows duplicate names when stable ids differ", () => {
    expect(
      subagentCatalogSchema
        .parse({
          subagents: [
            { id: "reviewer", name: "review" },
            { id: "reviewer-alt", name: "review" },
          ],
        })
        .subagents.map((subagent) => subagent.id),
    ).toEqual(["reviewer", "reviewer-alt"]);
  });

  test("rejects duplicate stable subagent ids", () => {
    expect(() =>
      subagentCatalogSchema.parse({
        subagents: [
          { id: "reviewer", name: "review" },
          { id: "reviewer", name: "review-copy" },
        ],
      }),
    ).toThrow("Duplicate subagent id: reviewer");
  });
});

import { expect, test } from "bun:test";

const IMAGE = "550e8400-e29b-41d4-a716-446655440000";
const KEPT = "750e8400-e29b-41d4-a716-446655440001";

/**
 * Descriptions and the result of removing the images of `IMAGE`. Each platform runs them with its
 * own Markdown parser, so the lock and the removal agree on which images count.
 */
const taskDescriptionImageRemovalCases = {
  assetIds: new Set([IMAGE]),
  keptAssetId: KEPT,
  cases: [
    {
      name: "an inline image on its own line and one in a sentence",
      markdown: `Intro\n![one](odt-asset:${IMAGE})\nSee ![two](odt-asset:${IMAGE}) here.\nEnd`,
      expected: "Intro\nSee  here.\nEnd",
    },
    {
      name: "an image whose name has escaped brackets and a title",
      markdown: `![chart\\[draft\\]](odt-asset:${IMAGE} "chart[draft].png")\nEnd`,
      expected: "End",
    },
    {
      name: "an image reference and its unused definition",
      markdown: `Intro ![chart][img]\n\n[img]: odt-asset:${IMAGE}\n`,
      expected: "Intro \n\n",
    },
    {
      name: "a definition that a link still uses",
      markdown: `![chart][img] and [file][img]\n\n[img]: odt-asset:${IMAGE}\n`,
      expected: ` and [file][img]\n\n[img]: odt-asset:${IMAGE}\n`,
    },
    {
      name: "a literal copy in a code block and another image",
      markdown: [
        `![one](odt-asset:${IMAGE})`,
        "```md",
        `![one](odt-asset:${IMAGE})`,
        "```",
        `![kept](odt-asset:${KEPT})`,
      ].join("\n"),
      expected: ["```md", `![one](odt-asset:${IMAGE})`, "```", `![kept](odt-asset:${KEPT})`].join(
        "\n",
      ),
    },
  ],
};

/**
 * Runs the cases with the parser of a platform. After each removal the platform collector finds
 * no removed image, so the workspace lock and Remove images agree.
 */
export const testTaskDescriptionImageRemoval = (
  removeImages: (markdown: string, assetIds: ReadonlySet<string>) => string,
  collectAssetIds: (markdown: string) => Set<string>,
): void => {
  const { assetIds, keptAssetId, cases } = taskDescriptionImageRemovalCases;
  test.each(cases)("removes $name", ({ markdown, expected }) => {
    const result = removeImages(markdown, assetIds);

    expect(result).toBe(expected);
    const remaining = collectAssetIds(result);
    expect([...remaining].filter((assetId) => assetId !== keptAssetId)).toEqual([]);
  });
};

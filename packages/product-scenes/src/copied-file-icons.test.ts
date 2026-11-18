import { describe, expect, test } from "bun:test";
import type { CallData } from "./replicas/transcript/model";
import {
  FILE_TYPE_COLORS,
  FILE_TYPE_ICONS,
  type FileType,
  type IconPath,
  fileTypeOf,
} from "./replicas/ui/FileTypeIcon";
import { storySessions } from "./sample/transcripts";
import { BUILD_FILES, FIXED_FILES, REVIEWED_FILES } from "./sample/studio";
import { FILES } from "./scenes/composer/sample";
import { GOAL_CALLS } from "./scenes/goal-command/sample";
import { GOAL_TRANSCRIPT } from "./scenes/goal-mode/sample";
import { RUNS as COMMENT_RUNS } from "./scenes/pr-comments/sample";
import { SYNC_CALLS } from "./scenes/question/sample";
import { importProduct, importProductDependency } from "./test-support/product-source";

// SAFETY: file-type-icons.ts exports this function, and a missing export fails the test.
const { resolveFileTypeIcon } = await importProduct<{
  resolveFileTypeIcon: (filePath: string) => { href: string; color: string | null } | null;
}>("packages/frontend/src/components/ui/file-type-icons.ts");
// SAFETY: @pierre/trees exports this function, and a missing export fails the test.
const { getBuiltInSpriteSheet } = await importProductDependency<{
  getBuiltInSpriteSheet: (iconSet: string) => string;
}>("@pierre/trees", "packages/frontend");

/** The icon set of file-type-icons.ts, which the file tree of the app also uses. */
const SHEET = getBuiltInSpriteSheet("complete");

/** The calls of the samples whose line shows the icon of the type of their file. */
const FILE_CALLS: readonly CallData[] = [
  ...[
    ...storySessions([
      { id: "spec", turns: 1 },
      { id: "planner", turns: 1 },
      { id: "qa", turns: 1 },
      { id: "build", turns: 4 },
    ]),
    GOAL_TRANSCRIPT,
  ].flatMap((session) =>
    session.turns.flatMap((turn) => turn.rows.flatMap((row) => (row.kind === "call" ? [row] : []))),
  ),
  ...GOAL_CALLS,
  ...COMMENT_RUNS.apply,
  ...SYNC_CALLS,
].filter((call) => call.file);

/** Each file that a line, a chip, or the Diffs tab of the samples shows with its icon. */
const PATHS = [
  ...FILE_CALLS.flatMap((call) => (call.summary ? [call.summary] : [])),
  ...[...BUILD_FILES, ...FIXED_FILES, ...REVIEWED_FILES].map((file) => file.path),
  ...FILES.map((file) => file.path),
];

const isFileType = (name: string): name is FileType => name in FILE_TYPE_ICONS;

/** The paths of the symbol of `type` in the icon sheet. */
function sheetPaths(type: FileType): IconPath[] {
  const symbol = new RegExp(`<symbol id="file-tree-builtin-${type}"[^>]*>([\\s\\S]*?)</symbol>`)
    .exec(SHEET)
    ?.at(1);
  if (symbol === undefined) throw new Error(`The icon sheet has no symbol for ${type}.`);
  return [...symbol.matchAll(/<path([^>]*)\/>/g)].map(([, attributes = ""]) => {
    const d = / d="([^"]+)"/.exec(attributes)?.at(1);
    if (d === undefined) throw new Error(`A path of the ${type} symbol has no geometry.`);
    const path: IconPath = { d };
    const opacity = /opacity="([^"]+)"/.exec(attributes)?.at(1);
    if (opacity !== undefined) path.opacity = opacity;
    if (attributes.includes('fill-rule="evenodd"')) path.evenOdd = true;
    return path;
  });
}

describe("the file type icons copied from the app", () => {
  test("each file of the samples has the icon and the color that the app gives its type", () => {
    expect(PATHS.length).toBeGreaterThan(0);
    for (const path of PATHS) {
      const type = fileTypeOf(path);
      const icon = resolveFileTypeIcon(path);
      expect(icon?.href ?? null).toBe(type === null ? null : `#file-tree-builtin-${type}`);
      expect(icon?.color ?? null).toBe(type === null ? null : FILE_TYPE_COLORS[type]);
    }
  });

  test("each icon has the geometry of the icon sheet of the app", () => {
    for (const type of Object.keys(FILE_TYPE_ICONS).filter(isFileType)) {
      const paths: readonly IconPath[] = FILE_TYPE_ICONS[type];
      expect([...paths]).toEqual(sheetPaths(type));
    }
  });
});

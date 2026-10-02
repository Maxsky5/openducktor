import { describe, expect, test } from "bun:test";
import type { FileDiff } from "@openducktor/contracts";
import {
  buildFileTree,
  buildListRows,
  collectDirectoryPaths,
  type FileListRow,
  findAnchorRow,
  flattenFileTree,
} from "./file-list-rows";
import { searchFiles, toSearchQuery } from "./file-list-search";

const fileDiff = (file: string): FileDiff => ({
  file,
  type: "modified",
  additions: 1,
  deletions: 1,
  diff: "@@ -1 +1 @@\n-old\n+new\n",
});

const treeRows = (
  files: string[],
  { searchText = "", closed = [] }: { searchText?: string; closed?: string[] } = {},
): FileListRow[] => {
  const matches = searchFiles(files.map(fileDiff), toSearchQuery(searchText));
  return flattenFileTree(buildFileTree(matches), new Set(closed));
};

const describeRow = (row: FileListRow): string => {
  const indent = "  ".repeat(row.depth);
  if (row.kind === "file") {
    return `${indent}${row.name.text}`;
  }
  return `${indent}${row.isOpen ? "v" : ">"} ${row.name.text}/`;
};

describe("buildFileTree", () => {
  test("groups files by directory with directories first and names in alphabetical order", () => {
    const rows = treeRows([
      "src/b.ts",
      "README.md",
      "src/lib/z.ts",
      "src/A.ts",
      "docs/guide.md",
      "src/lib/y.ts",
      ".github/ci.yml",
      "AGENTS.md",
    ]);

    expect(rows.map(describeRow)).toEqual([
      "v .github/",
      "  ci.yml",
      "v docs/",
      "  guide.md",
      "v src/",
      "  v lib/",
      "    y.ts",
      "    z.ts",
      "  A.ts",
      "  b.ts",
      "AGENTS.md",
      "README.md",
    ]);
  });

  test("joins chains of single sub-directories at every level", () => {
    const rows = treeRows([
      "apps/storefront/adapters/vendure/client.ts",
      "apps/storefront/app/page.tsx",
      "apps/storefront/next.config.ts",
    ]);

    expect(rows.map(describeRow)).toEqual([
      "v apps/storefront/",
      "  v adapters/vendure/",
      "    client.ts",
      "  v app/",
      "    page.tsx",
      "  next.config.ts",
    ]);
    const joinedRow = rows[0];
    expect(joinedRow?.kind === "directory" && joinedRow.chainPaths).toEqual([
      "apps",
      "apps/storefront",
    ]);
    expect(joinedRow?.key).toBe("dir:apps/storefront");
  });

  test("keeps a file and a directory with the same path as separate rows", () => {
    const rows = treeRows(["lib", "lib/index.ts"]);

    expect(rows.map((row) => row.key)).toEqual(["dir:lib", "file:lib/index.ts", "file:lib"]);
  });

  test("shows only the directories that contain a match and joins the filtered chains", () => {
    const rows = treeRows(["src/app/main.ts", "src/lib/util.ts", "docs/notes.md"], {
      searchText: "util",
    });

    expect(rows.map(describeRow)).toEqual(["v src/lib/", "  util.ts"]);
  });

  test("highlights the matched characters in directory and file names", () => {
    const rows = treeRows(
      ["apps/web/next.config.ts", "apps/web/app.ts", "apps/web/next.env.d.ts"],
      {
        searchText: "w next",
      },
    );

    expect(rows.map(describeRow)).toEqual(["v apps/web/", "  next.config.ts", "  next.env.d.ts"]);
    const [directory, ...files] = rows;
    expect(directory?.name.highlights).toEqual([{ start: 5, end: 6 }]);
    for (const file of files) {
      expect(file.name.highlights).toEqual([{ start: 0, end: 4 }]);
      expect(file.kind === "file" && file.directory).toBeNull();
    }
  });
});

describe("flattenFileTree", () => {
  test("hides the contents of a closed directory", () => {
    const rows = treeRows(["src/lib/a.ts", "src/main.ts", "README.md"], {
      closed: ["src/lib"],
    });

    expect(rows.map(describeRow)).toEqual(["v src/", "  > lib/", "  main.ts", "README.md"]);
  });

  test("closes a joined row when any of its directories is closed", () => {
    expect(treeRows(["a/b/c.ts"], { closed: ["a"] }).map(describeRow)).toEqual(["> a/b/"]);
    expect(treeRows(["a/b/c.ts"], { closed: ["a/b"] }).map(describeRow)).toEqual(["> a/b/"]);
  });

  test("keeps file rows the same when a directory toggles", () => {
    const tree = buildFileTree(searchFiles([fileDiff("src/a.ts"), fileDiff("b.ts")], ""));
    const openRows = flattenFileTree(tree, new Set());
    const closedRows = flattenFileTree(tree, new Set(["src"]));

    expect(closedRows.at(-1)).toBe(openRows.at(-1));
  });
});

describe("buildListRows", () => {
  test("keeps the input order and splits highlights between the name and the directory", () => {
    const matches = searchFiles(
      [fileDiff("src/zeta.ts"), fileDiff("lib/alpha.ts")],
      toSearchQuery("l/a"),
    );
    const rows = buildListRows(matches);

    expect(rows.map((row) => row.key)).toEqual(["file:lib/alpha.ts"]);
    expect(rows[0]).toMatchObject({
      depth: 0,
      name: { text: "alpha.ts", highlights: [{ start: 0, end: 1 }] },
      directory: { text: "lib", highlights: [{ start: 0, end: 1 }] },
    });
  });

  test("keeps the order of files from the host", () => {
    const rows = buildListRows(
      searchFiles([fileDiff("src/zeta.ts"), fileDiff("README.md"), fileDiff("src/alpha.ts")], ""),
    );

    expect(rows.map((row) => row.diff.file)).toEqual(["src/zeta.ts", "README.md", "src/alpha.ts"]);
    expect(rows[1]?.directory).toBeNull();
  });
});

describe("collectDirectoryPaths", () => {
  test("returns every ancestor directory of every file", () => {
    expect(
      collectDirectoryPaths([fileDiff("a/b/c.ts"), fileDiff("a/d.ts"), fileDiff("root.ts")]),
    ).toEqual(new Set(["a/b", "a"]));
  });
});

describe("findAnchorRow", () => {
  const listRows = (files: string[]): FileListRow[] =>
    buildListRows(searchFiles(files.map(fileDiff), ""));
  const anchorAt = (rows: FileListRow[], index: number) => ({
    key: rows[index]?.key ?? "",
    index,
    rows,
  });
  const FILES = ["a/one.ts", "b/one.ts", "b/two.ts", "c/one.ts"];

  test("finds the anchor row by its key", () => {
    const oldRows = listRows(FILES);
    const newRows = listRows(["a/new.ts", ...FILES]);

    expect(findAnchorRow(newRows, anchorAt(oldRows, 2))).toEqual({ index: 3, isAnchorRow: true });
  });

  test("uses the first file of a directory that list view does not show", () => {
    const tree = treeRows(FILES);
    const directoryIndex = tree.findIndex((row) => row.key === "dir:b");

    expect(findAnchorRow(listRows(FILES), anchorAt(tree, directoryIndex))).toEqual({
      index: 1,
      isAnchorRow: false,
    });
  });

  test("uses the closed directory that hides the anchor file", () => {
    const tree = treeRows(FILES, { closed: ["b"] });

    expect(findAnchorRow(tree, anchorAt(listRows(FILES), 2))).toEqual({
      index: tree.findIndex((row) => row.key === "dir:b"),
      isAnchorRow: false,
    });
  });

  test("uses the next row that is still shown when the anchor row is gone", () => {
    const oldRows = listRows(FILES);
    // The refresh removes the anchor and the row above it.
    const newRows = listRows(["b/two.ts", "c/one.ts"]);

    expect(findAnchorRow(newRows, anchorAt(oldRows, 1))).toEqual({ index: 0, isAnchorRow: false });
  });

  test("stays inside the rows when no later row is still shown", () => {
    const oldRows = listRows(FILES);

    expect(findAnchorRow(listRows(["a/one.ts"]), anchorAt(oldRows, 3))).toEqual({
      index: 0,
      isAnchorRow: false,
    });
  });
});

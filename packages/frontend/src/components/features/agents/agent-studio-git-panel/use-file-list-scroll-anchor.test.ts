import { describe, expect, test } from "bun:test";
import type { GitFileDiff } from "@openducktor/contracts";
import { act, renderHook } from "@testing-library/react";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { FILE_LIST_ROW_HEIGHT } from "./constants";
import { buildListRows, type FileListRow } from "./file-list-rows";
import { searchFiles } from "./file-list-search";
import { useFileListScrollAnchor } from "./use-file-list-scroll-anchor";

enableReactActEnvironment();

type HookProps = Parameters<typeof useFileListScrollAnchor>[0];

const HEADER_DIFFERENCE = FILE_LIST_ROW_HEIGHT.list - FILE_LIST_ROW_HEIGHT.tree;

const listRows = (...files: string[]): FileListRow[] =>
  buildListRows(
    searchFiles(
      files.map((file): GitFileDiff => ({
        file,
        type: "modified",
        additions: 1,
        deletions: 1,
        diff: "@@ -1 +1 @@\n-old\n+new\n",
      })),
      "",
    ),
  );

const renderScrollAnchor = (rows: readonly FileListRow[]) => {
  const props: HookProps = {
    rows,
    measurementKey: "owner-1",
    viewMode: "list",
    scrollResetKey: "",
  };
  const view = renderHook((hookProps: HookProps) => useFileListScrollAnchor(hookProps), {
    initialProps: props,
  });
  return {
    rowHeight: () => view.result.current.rowHeight,
    measure: (rowKey: string, height: number) => {
      act(() => view.result.current.onMeasureRow(rowKey, height));
    },
    rerender: (next: Partial<HookProps>) => {
      Object.assign(props, next);
      act(() => view.rerender({ ...props }));
    },
  };
};

describe("useFileListScrollAnchor row heights", () => {
  test("keeps a known height with its row when the rows move or a row is hidden", () => {
    const rows = listRows("a.ts", "b.ts");
    const anchor = renderScrollAnchor(rows);
    anchor.measure("file:b.ts", 800);
    expect(anchor.rowHeight().getRowHeight(1)).toBe(800);

    anchor.rerender({ rows: listRows("b.ts", "a.ts") });
    expect(anchor.rowHeight().getRowHeight(0)).toBe(800);

    anchor.rerender({ rows: listRows("a.ts") });
    anchor.rerender({ rows });
    expect(anchor.rowHeight().getRowHeight(1)).toBe(800);
  });

  test("estimates the rows that are not measured from the smallest measured row", () => {
    const anchor = renderScrollAnchor(listRows("a.ts", "b.ts", "c.ts"));
    expect(anchor.rowHeight().getAverageRowHeight()).toBe(FILE_LIST_ROW_HEIGHT.list);

    anchor.measure("file:a.ts", 800);
    anchor.measure("file:b.ts", 41);

    expect(anchor.rowHeight().getRowHeight(2)).toBeUndefined();
    expect(anchor.rowHeight().getAverageRowHeight()).toBe(41);
  });

  test("changes the known heights by the row header difference after a view switch", () => {
    const anchor = renderScrollAnchor(listRows("a.ts", "b.ts", "c.ts"));
    anchor.measure("file:a.ts", 41);
    anchor.measure("file:b.ts", 800);

    // Until a tree row is measured, the estimate comes from the measured list rows.
    anchor.rerender({ viewMode: "tree" });
    expect(anchor.rowHeight().getAverageRowHeight()).toBe(41 - HEADER_DIFFERENCE);
    expect(anchor.rowHeight().getRowHeight(1)).toBe(800 - HEADER_DIFFERENCE);

    // The estimate uses the smallest height below a header from all views.
    anchor.measure("file:c.ts", 30);
    expect(anchor.rowHeight().getAverageRowHeight()).toBe(41 - HEADER_DIFFERENCE);
    expect(anchor.rowHeight().getRowHeight(0)).toBe(41 - HEADER_DIFFERENCE);
    expect(anchor.rowHeight().getRowHeight(1)).toBe(800 - HEADER_DIFFERENCE);

    anchor.rerender({ viewMode: "list" });
    expect(anchor.rowHeight().getAverageRowHeight()).toBe(41);
    expect(anchor.rowHeight().getRowHeight(1)).toBe(800);
    expect(anchor.rowHeight().getRowHeight(2)).toBe(30 + HEADER_DIFFERENCE);
  });

  test("keeps an expanded height after a view switch when only expanded rows were measured", () => {
    const anchor = renderScrollAnchor(listRows("a.ts", "b.ts"));
    anchor.measure("file:a.ts", 800);

    anchor.rerender({ viewMode: "tree" });
    anchor.measure("file:b.ts", 29);

    expect(anchor.rowHeight().getRowHeight(0)).toBe(800 - HEADER_DIFFERENCE);
  });

  test("drops the known heights for a new measurement key", () => {
    const anchor = renderScrollAnchor(listRows("a.ts"));
    anchor.measure("file:a.ts", 800);

    anchor.rerender({ measurementKey: "owner-2" });

    expect(anchor.rowHeight().getRowHeight(0)).toBeUndefined();
    expect(anchor.rowHeight().getAverageRowHeight()).toBe(FILE_LIST_ROW_HEIGHT.list);
  });
});

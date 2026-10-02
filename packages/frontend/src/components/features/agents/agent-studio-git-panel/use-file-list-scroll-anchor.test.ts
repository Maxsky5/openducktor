import { describe, expect, test } from "bun:test";
import type { FileDiff } from "@openducktor/contracts";
import { act, renderHook } from "@testing-library/react";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { FILE_LIST_ROW_HEIGHT } from "./constants";
import { buildListRows, type FileListRow } from "./file-list-rows";
import { searchFiles } from "./file-list-search";
import { useFileListScrollAnchor } from "./use-file-list-scroll-anchor";

enableReactActEnvironment();

type HookProps = Parameters<typeof useFileListScrollAnchor>[0];

const listRows = (...files: string[]): FileListRow[] =>
  buildListRows(
    searchFiles(
      files.map((file): FileDiff => ({
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
  const props: HookProps = { rows, measurementKey: "owner-1", scrollResetKey: "" };
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
    expect(anchor.rowHeight().getAverageRowHeight()).toBe(FILE_LIST_ROW_HEIGHT);

    anchor.measure("file:a.ts", 800);
    anchor.measure("file:b.ts", 41);

    expect(anchor.rowHeight().getRowHeight(2)).toBeUndefined();
    expect(anchor.rowHeight().getAverageRowHeight()).toBe(41);
  });

  test("drops the known heights for a new measurement key", () => {
    const anchor = renderScrollAnchor(listRows("a.ts"));
    anchor.measure("file:a.ts", 800);

    anchor.rerender({ measurementKey: "owner-2" });

    expect(anchor.rowHeight().getRowHeight(0)).toBeUndefined();
    expect(anchor.rowHeight().getAverageRowHeight()).toBe(FILE_LIST_ROW_HEIGHT);
  });
});

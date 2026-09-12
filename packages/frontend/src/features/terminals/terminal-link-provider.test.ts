import { describe, expect, test } from "bun:test";
import type { IBufferCell, IBufferLine, ILink, Terminal } from "@xterm/xterm";
import { createHttpLinkProvider } from "./terminal-link-provider";

type TestCell = Pick<IBufferCell, "getChars" | "getCode" | "getWidth">;

const createCell = (value: string, width = 1): TestCell => ({
  getChars: () => value,
  getCode: () => (value.length > 0 ? (value.codePointAt(0) ?? 0) : 0),
  getWidth: () => width,
});

const createLine = (cells: TestCell[], columns: number, isWrapped: boolean): IBufferLine => {
  const padded = [...cells];
  while (padded.length < columns) padded.push(createCell(""));
  return {
    isWrapped,
    length: padded.length,
    // SAFETY: The provider reads only the three cell methods in TestCell.
    getCell: (column) => padded[column] as IBufferCell | undefined,
    translateToString: () => "",
  };
};

const createTextLine = (text: string, columns: number, isWrapped: boolean): IBufferLine =>
  createLine(
    Array.from(text, (character) => createCell(character)),
    columns,
    isWrapped,
  );

const createTerminal = (
  lines: IBufferLine[],
  columns: number,
): Pick<Terminal, "buffer" | "cols"> => {
  const active = {
    length: lines.length,
    getLine: (row: number) => lines[row],
  };
  return {
    cols: columns,
    // SAFETY: The provider reads only active.length and active.getLine from this fake.
    buffer: { active } as Terminal["buffer"],
  };
};

const readTerminalLinksForBufferLine = (
  terminal: Pick<Terminal, "buffer" | "cols">,
  row: number,
): ILink[] => {
  const provider = createHttpLinkProvider(terminal, {
    activate: () => undefined,
    hover: () => undefined,
    leave: () => undefined,
  });
  let links: ILink[] | undefined;
  provider.provideLinks(row, (provided) => {
    links = provided;
  });
  return links ?? [];
};

describe("terminal HTTP link provider", () => {
  test("joins soft-wrapped rows and maps the complete URL to terminal cells", () => {
    const columns = 12;
    const terminal = createTerminal(
      [
        createTextLine("go https://e", columns, false),
        createTextLine("xample.com/a", columns, true),
        createTextLine("?x=1", columns, true),
      ],
      columns,
    );

    const links = readTerminalLinksForBufferLine(terminal, 2);

    expect(links[0]?.text).toBe("https://example.com/a?x=1");
    expect(links[0]?.range).toEqual({
      start: { x: 4, y: 1 },
      end: { x: 4, y: 3 },
    });
  });

  test("does not join separate logical lines", () => {
    const columns = 24;
    const terminal = createTerminal(
      [
        createTextLine("https://one.test", columns, false),
        createTextLine("/not-part-of-the-link", columns, false),
      ],
      columns,
    );

    expect(readTerminalLinksForBufferLine(terminal, 1)[0]?.text).toBe("https://one.test");
    expect(readTerminalLinksForBufferLine(terminal, 2)).toEqual([]);
  });

  test("accounts for wide and combining cells before a link", () => {
    const cells = [
      createCell("界", 2),
      createCell("", 0),
      createCell("e\u0301"),
      createCell(" "),
      ...Array.from("https://a.test", (character) => createCell(character)),
    ];
    const terminal = createTerminal([createLine(cells, cells.length, false)], cells.length);

    expect(readTerminalLinksForBufferLine(terminal, 1)[0]?.range).toEqual({
      start: { x: 5, y: 1 },
      end: { x: 18, y: 1 },
    });
  });
});

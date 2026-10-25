import type { IBufferCellPosition, ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import {
  createTerminalLinkReader,
  type TerminalLinkTarget,
} from "@openducktor/frontend-core/terminals/terminal-link-targets";

type LinkCallbacks = {
  hover(event: MouseEvent, target: TerminalLinkTarget): void;
  leave(event: MouseEvent, target: TerminalLinkTarget): void;
};

export type HttpLinkProvider = ILinkProvider & {
  clear(): void;
  findLinkAt(position: IBufferCellPosition): TerminalLinkTarget | null;
  isCurrent(target: TerminalLinkTarget): boolean;
};

export const createHttpLinkProvider = (
  terminal: Pick<Terminal, "buffer" | "cols">,
  callbacks: LinkCallbacks,
): HttpLinkProvider => {
  const reader = createTerminalLinkReader(terminal);
  return {
    clear: reader.clear,
    provideLinks: (row, callback) => {
      const links: ILink[] = reader.linksAtRow(row).map((target) => ({
        text: target.url,
        range: target.range,
        decorations: { pointerCursor: false, underline: true },
        activate: () => {
          // The capture handler opens links.
        },
        hover: (event) => callbacks.hover(event, target),
        leave: (event) => callbacks.leave(event, target),
      }));
      callback(links.length > 0 ? links : undefined);
    },
    findLinkAt: reader.findLinkAt,
    isCurrent: reader.isCurrent,
  };
};

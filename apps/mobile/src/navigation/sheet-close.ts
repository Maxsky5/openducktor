import { createContext, use } from "react";

/** The close action of the open sheet, which a form footer shows as its Cancel button. */
export type SheetClose = {
  close: () => void;
  /** False while a command runs, so Cancel cannot close the sheet. */
  closable: boolean;
  /**
   * Moves the close control of the sheet into the footer that calls it, until the returned
   * function runs. The header then shows only the title.
   */
  claimFooter: () => () => void;
};

export const SheetCloseContext = createContext<SheetClose | null>(null);

/** The close action of the sheet around this view, or null outside a sheet. */
export const useSheetClose = (): SheetClose | null => use(SheetCloseContext);

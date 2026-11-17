import { createContext } from "react";

/** The shortcut position of each visible session row, by entry key. */
export const SessionPositionsContext = createContext<ReadonlyMap<string, number>>(new Map());

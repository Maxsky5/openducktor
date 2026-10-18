import { createContext } from "react";

/**
 * True while the Markdown block around the consumer streams and ends in a code fence that is not
 * closed. The code in that fence can still change.
 */
export const MarkdownOpenFenceContext = createContext(false);

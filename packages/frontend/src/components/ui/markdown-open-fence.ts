import { createContext } from "react";

/**
 * The code of the fence that the streaming Markdown block around the consumer ends in, while that
 * fence is not closed. The code can still change.
 */
export const MarkdownOpenFenceContext = createContext<string | null>(null);

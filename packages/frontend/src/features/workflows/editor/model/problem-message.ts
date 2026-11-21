/** A part of a problem message: plain text, a quoted ID, or a quoted label. */
export type MessagePart = { readonly kind: "text" | "id" | "label"; readonly text: string };

/** An ID has lowercase words joined by `-`, `_`, `.`, or `:`, and no space. */
const ID_PATTERN = /^[a-z0-9]+(?:[-_.:][a-z0-9]+)*$/;

/**
 * Splits a problem message at its quoted names, so the list shows an ID in code style and a label
 * in typographic quotes instead of straight quotes.
 */
export const messageParts = (message: string): MessagePart[] =>
  message
    .split(/"([^"]*)"/)
    .map((text, index): MessagePart => {
      if (index % 2 === 0) return { kind: "text", text };
      return { kind: ID_PATTERN.test(text) ? "id" : "label", text };
    })
    .filter(({ kind, text }) => kind !== "text" || text.length > 0);

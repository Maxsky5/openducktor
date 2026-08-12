export type MermaidPreview =
  | { status: "ready"; svg: string }
  | { status: "error"; message: string };

export type MermaidPreviews = ReadonlyMap<string, MermaidPreview>;

export const getMermaidErrorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "Mermaid could not parse this diagram.";

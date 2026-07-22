import type { MermaidConfig } from "mermaid";

let initialized = false;

export const MERMAID_RENDER_CONFIG = {
  startOnLoad: false,
  securityLevel: "strict",
  suppressErrorRendering: true,
  htmlLabels: false,
} satisfies MermaidConfig;

export async function renderMermaidSvg(renderId: string, source: string): Promise<string> {
  const [mermaidModule, sanitizeModule] = await Promise.all([
    import("mermaid"),
    import("./markdown-mermaid-sanitize"),
  ]);
  const mermaid = mermaidModule.default;
  if (!initialized) {
    mermaid.initialize(MERMAID_RENDER_CONFIG);
    initialized = true;
  }
  const rendered = await mermaid.render(renderId, source);
  return sanitizeModule.sanitizeMermaidSvg(rendered.svg);
}

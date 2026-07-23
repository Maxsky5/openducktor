import type { MermaidConfig } from "mermaid";

let initialized = false;

export const MERMAID_RENDER_CONFIG = {
  startOnLoad: false,
  securityLevel: "strict",
  suppressErrorRendering: true,
  htmlLabels: false,
} satisfies MermaidConfig;

function createMermaidRenderContainer(): HTMLDivElement {
  const container = document.createElement("div");
  container.setAttribute("aria-hidden", "true");
  Object.assign(container.style, {
    position: "fixed",
    inset: "0",
    overflow: "hidden",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.append(container);
  return container;
}

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
  const renderContainer = createMermaidRenderContainer();
  try {
    const rendered = await mermaid.render(renderId, source, renderContainer);
    return sanitizeModule.sanitizeMermaidSvg(rendered.svg);
  } finally {
    renderContainer.remove();
  }
}

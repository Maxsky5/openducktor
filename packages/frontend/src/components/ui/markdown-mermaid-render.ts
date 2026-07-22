let initialized = false;

export async function renderMermaidSvg(renderId: string, source: string): Promise<string> {
  const [mermaidModule, sanitizeModule] = await Promise.all([
    import("mermaid"),
    import("./markdown-mermaid-sanitize"),
  ]);
  const mermaid = mermaidModule.default;
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
    });
    initialized = true;
  }
  const rendered = await mermaid.render(renderId, source);
  return sanitizeModule.sanitizeMermaidSvg(rendered.svg);
}

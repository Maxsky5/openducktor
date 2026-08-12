import DOMPurify from "dompurify";

const UNSAFE_LINK_PATTERN = /^\s*(?:data|javascript|vbscript):/i;

export const sanitizeMermaidSvg = (svg: string): string => {
  const sanitized = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["foreignObject", "iframe", "object", "embed", "script"],
    FORBID_ATTR: ["onload", "onclick", "onerror"],
  });

  const document = new DOMParser().parseFromString(sanitized, "image/svg+xml");
  if (document.querySelector("parsererror")) {
    throw new Error("Mermaid generated invalid SVG output.");
  }
  document.querySelectorAll("foreignObject, iframe, object, embed, script").forEach((node) => {
    node.remove();
  });
  const elements = [document.documentElement, ...document.querySelectorAll("*")];
  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("on") ||
        (name.endsWith("href") && UNSAFE_LINK_PATTERN.test(attribute.value))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return new XMLSerializer().serializeToString(document.documentElement);
};

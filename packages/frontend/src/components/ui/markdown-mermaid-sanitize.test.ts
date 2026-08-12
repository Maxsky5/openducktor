import { expect, test } from "bun:test";
import { sanitizeMermaidSvg } from "./markdown-mermaid-sanitize";

test("removes active and foreign content from generated Mermaid SVG", () => {
  const maliciousSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)">
      <rect width="10" height="10" onclick="alert(5)" />
      <text>safe label</text>
      <script>alert(1)</script>
      <foreignObject><iframe srcdoc="<script>alert(2)</script>"></iframe></foreignObject>
      <a href="javascript:alert(3)" xlink:href="javascript:alert(4)"><text>unsafe</text></a>
    </svg>
  `;

  const sanitized = sanitizeMermaidSvg(maliciousSvg);

  expect(sanitized).toContain("<svg");
  expect(sanitized).toContain("<rect");
  expect(sanitized).toContain("<text>safe label</text>");
  expect(sanitized).not.toContain("script");
  expect(sanitized).not.toContain("foreignObject");
  expect(sanitized).not.toContain("iframe");
  expect(sanitized).not.toContain("javascript:");
  expect(sanitized).not.toContain("onload");
  expect(sanitized).not.toContain("onclick");
});

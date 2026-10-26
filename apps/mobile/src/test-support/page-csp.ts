import { createHash } from "node:crypto";
import { pageContentSecurityPolicy } from "../../scripts/build-isolated-page";

/**
 * The CSP meta element that lets the inline script of `html` run. The hash covers the script text
 * as the WebView reads it: the HTML parser turns each CR LF or CR into LF.
 */
export const pageCspMeta = (html: string): string => {
  const script = (/<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "").replace(/\r\n?/g, "\n");
  const hash = createHash("sha256").update(script).digest("base64");
  return `<meta http-equiv="Content-Security-Policy" content="${pageContentSecurityPolicy(hash)}">`;
};

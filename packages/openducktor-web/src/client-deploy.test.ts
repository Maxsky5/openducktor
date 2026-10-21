import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

// The deploy token can update only this Worker, so a route, custom domain, or address setting fails
// the deploy. A Worker script, `run_worker_first`, or a binding would run code on requests.
test("wrangler.json deploys only the static files of dist/client to the existing Worker", () => {
  expect(JSON.parse(read("wrangler.json"))).toEqual({
    $schema: expect.any(String),
    name: "openducktor-web-client",
    compatibility_date: expect.any(String),
    workers_dev: false,
    preview_urls: false,
    // Remote mode uses hash routes, so an unknown path is a real miss.
    assets: { directory: "./dist/client", not_found_handling: "none" },
  });
});

describe("client/_headers", () => {
  const lines = read("client/_headers").split("\n");
  const headers = new Map(
    lines
      .filter((line) => line.startsWith("  "))
      .map((line) => {
        const separator = line.indexOf(":");
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
  );
  const policy = new Map(
    (headers.get("Content-Security-Policy") ?? "").split(";").map((directive) => {
      const [name = "", ...sources] = directive.trim().split(/\s+/);
      return [name, sources];
    }),
  );

  test("applies to every path of the site", () => {
    expect(lines[0]).toBe("/*");
  });

  test("blocks framing, other scripts, eval, plugins, base changes, and form posts", () => {
    expect(policy.get("default-src")).toEqual(["'none'"]);
    expect(policy.get("script-src")).toEqual(["'self'"]);
    expect(policy.get("worker-src")).toEqual(["'self'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'none'"]);
    expect(policy.get("form-action")).toEqual(["'none'"]);
    expect(headers.get("Content-Security-Policy")).not.toContain("unsafe-eval");
  });

  test("allows only the inline event handlers of index.html", () => {
    const html = read("index.html");
    const handlers = [...html.matchAll(/\son[a-z]+="([^"]*)"/g)].map(
      ([, source]) =>
        `'sha256-${createHash("sha256")
          .update(source ?? "")
          .digest("base64")}'`,
    );
    expect(handlers.length).toBeGreaterThan(0);
    expect(policy.get("script-src-attr")).toEqual(["'unsafe-hashes'", ...handlers]);
    // `script-src 'self'` blocks inline script elements.
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
  });

  test("sends HSTS for a year, no MIME sniffing, and no referrer", () => {
    expect(headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});

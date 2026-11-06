import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, resolveConfig } from "vite";
import { OPEN_DUCKTOR_STARTUP_BACKGROUND } from "./theme";
import { createOpenDucktorStartupSplashPlugin } from "./vite-plugin";

const electronConfig = await resolveConfig({ configFile: false, base: "./" }, "build");

describe("startup splash Vite plugin", () => {
  test("injects the shared startup surface before the application shell", () => {
    const plugin = createOpenDucktorStartupSplashPlugin();
    plugin.configResolved(electronConfig);
    const result = plugin.transformIndexHtml();
    const fontPreload = result.tags.find((tag) => tag.attrs?.rel === "preload");
    const styles = result.tags.find((tag) => tag.tag === "style");
    const splash = result.tags.find((tag) => tag.attrs?.id === "openducktor-startup");

    expect(plugin.enforce).toBe("pre");
    expect(styles?.injectTo).toBe("head-prepend");
    expect(styles?.children).toContain(OPEN_DUCKTOR_STARTUP_BACKGROUND);
    expect(styles?.children).not.toContain("prefers-color-scheme");
    expect(styles?.children).not.toContain(":root.light");
    expect(styles?.children).not.toContain(":root.dark");
    expect(styles?.children).not.toContain("gradient");
    expect(styles?.children).toContain('font-family: "Space Grotesk"');
    expect(styles?.children).toContain("--odt-startup-title: #475569");
    expect(fontPreload?.attrs?.href).toBe("./fonts/space-grotesk-latin-wght-normal.woff2");
    expect(fontPreload?.attrs?.type).toBe("font/woff2");
    expect(splash?.injectTo).toBe("body-prepend");
    expect(splash?.attrs?.role).toBe("status");
    expect("aria-live" in (splash?.attrs ?? {})).toBe(false);
    expect(splash?.children).toContain('<p class="odt-startup__title">OpenDucktor</p>');
    expect(splash?.children).toContain('<div class="odt-startup__orbit" aria-hidden="true">');
    expect(splash?.children).toContain('<div class="odt-startup__particles" aria-hidden="true">');
    expect(
      splash?.children?.match(/class="odt-startup__particle odt-startup__particle--/g),
    ).toHaveLength(18);
    expect(splash?.children).toContain("odt-startup__particle--ring");
    expect(splash?.children).toContain("odt-startup__particle--spark");
    expect(splash?.children).not.toContain("odt-startup__launch-panel");
    expect(splash?.children).toContain("./favicon.svg");
  });
  test("packages every declared local face and its notices", () => {
    const plugin = createOpenDucktorStartupSplashPlugin();
    plugin.configResolved(electronConfig);
    const assets = new Map<string, Buffer>();
    plugin.generateBundle.call({
      emitFile(asset) {
        assets.set(asset.fileName, asset.source);
        return asset.fileName;
      },
    });
    const styles =
      plugin.transformIndexHtml().tags.find((tag) => tag.tag === "style")?.children ?? "";
    const urls = [...styles.matchAll(/url\(["']?(\.\/fonts\/[^)"']+)/g)].map(
      (match) => match[1]?.slice(2) ?? "",
    );
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(assets.get(url)?.subarray(0, 4).toString()).toBe("wOF2");
    }
    expect(new Set(urls).size).toBe(urls.length);
    expect([...assets.keys()].filter((name) => name.endsWith(".woff2")).sort()).toEqual(
      [...urls].sort(),
    );
    expect(assets.get("fonts/space-grotesk-OFL.txt")?.toString()).toContain(
      "SIL OPEN FONT LICENSE",
    );
    expect(assets.get("fonts/ibm-plex-mono-OFL.txt")?.toString()).toContain(
      "SIL OPEN FONT LICENSE",
    );
  });
  // This test runs real Vite builds for both shell bases.
  test("builds required font weights for web routes and Electron HTML", async () => {
    const directory = mkdtempSync(join(tmpdir(), "odt-font-build-"));
    try {
      writeFileSync(
        join(directory, "index.html"),
        "<!doctype html><html><head></head><body></body></html>",
      );
      for (const base of ["/", "./"]) {
        const outDir = join(directory, base === "/" ? "web" : "electron");
        await build({
          configFile: false,
          root: directory,
          base,
          logLevel: "silent",
          plugins: [createOpenDucktorStartupSplashPlugin()],
          build: { outDir },
        });
        const html = readFileSync(join(outDir, "index.html"), "utf8");
        const urls = [...html.matchAll(/url\(["']?([^)"']+\.woff2)/g)].map(
          (match) => match[1] ?? "",
        );
        const preload = html.match(/rel="preload" href="([^"]+)"/)?.[1] ?? "";
        const monoWeights = [...html.matchAll(/@font-face\s*\{([^}]+)\}/g)]
          .map((match) => match[1] ?? "")
          .filter((face) => face.includes('font-family: "IBM Plex Mono"'))
          .map((face) => face.match(/font-weight:\s*(\d+)/)?.[1]);
        // Markdown code requests medium; the syntax highlighter requests regular.
        expect(new Set(monoWeights)).toEqual(new Set(["400", "500"]));
        expect(urls).toHaveLength(13);
        expect(urls).toContain(preload);
        const documents =
          base === "/"
            ? ["http://localhost/sessions/", "http://localhost/kanban/"]
            : [pathToFileURL(join(outDir, "index.html")).href];
        for (const document of documents) {
          for (const url of urls) {
            const resolved = new URL(url, document);
            const assetPath =
              resolved.protocol === "file:"
                ? fileURLToPath(resolved)
                : join(outDir, resolved.pathname);
            expect(readFileSync(assetPath).subarray(0, 4).toString()).toBe("wOF2");
          }
        }
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 10_000);
});

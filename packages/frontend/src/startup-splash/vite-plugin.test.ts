import { describe, expect, test } from "bun:test";
import { OPEN_DUCKTOR_STARTUP_BACKGROUND } from "./theme";
import { createOpenDucktorStartupSplashPlugin } from "./vite-plugin";

describe("startup splash Vite plugin", () => {
  test("injects the shared startup surface before the application shell", () => {
    const plugin = createOpenDucktorStartupSplashPlugin();
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
    expect(fontPreload?.attrs?.href).toBe("./fonts/space-grotesk-latin-600.woff2");
    expect(fontPreload?.attrs?.type).toBe("font/woff2");
    expect(splash?.injectTo).toBe("body-prepend");
    expect(splash?.attrs?.role).toBe("status");
    expect(splash?.attrs?.["aria-live"]).toBeUndefined();
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
});

import { commands, links } from "../src/content/site";
import { expect, horizontalOverflow, reload, test } from "./fixtures";
import { ORIGIN } from "./server";

test("the opening shows the claim, the download, and the browser command", async ({
  page,
}, testInfo) => {
  const hero = page.locator(".hero");
  await expect(page).toHaveTitle("OpenDucktor | Open-source mission control for coding agents");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Open-source mission control for coding agents.",
  );
  // The header names the latest version next to the brand. A phone header has no room for it.
  const release = page.getByRole("link", {
    name: /^Release notes of version \d+\.\d+\.\d+$/,
    includeHidden: true,
  });
  // The pill opens the notes of the version that it shows.
  const version = (await release.getAttribute("aria-label"))?.split(" ").at(-1);
  await expect(release).toHaveText(`v${version}`);
  await expect(release).toHaveAttribute("href", `${links.releases}/tag/v${version}`);
  if (testInfo.project.name.startsWith("desktop")) await expect(release).toBeVisible();
  else await expect(release).toBeHidden();
  const download = hero.getByRole("link", { name: "Download", exact: true });
  await expect(download).toBeInViewport();
  await expect(download).toHaveAttribute("href", links.latest);
  await expect(hero.locator(".command code")).toHaveText(commands.browser);
  const downloads = page.getByRole("link", { name: "Download", exact: true });
  expect(await downloads.count()).toBeGreaterThan(1);
  for (const href of await downloads.evaluateAll((items) =>
    items.map((item) => item.getAttribute("href")),
  )) {
    expect(href).toBe(links.latest);
  }
});

test("each product view is HTML with a text alternative", async ({ page }) => {
  const views = page.locator('[data-stage][role="img"]');
  expect(await views.count()).toBeGreaterThanOrEqual(12);
  for (const view of await views.all()) {
    await expect(view).toHaveAttribute("aria-label", /\w{3,}/);
  }
  // Screen readers read the text alternative. The copied UI has no headings or landmarks, so the
  // page outline stays the outline of the site.
  await expect(
    page.locator("[data-stage] :is(h1, h2, h3, h4, h5, h6, section, article, nav, header, footer)"),
  ).toHaveCount(0);
  await expect(page.locator("[data-stage] :is(img, picture, canvas, video)")).toHaveCount(0);
});

test("the header links go to their sections below the sticky header", async ({
  page,
}, testInfo) => {
  const hrefs = await page
    .locator(".site-nav a")
    .evaluateAll((items) => items.map((item) => item.getAttribute("href") ?? ""));
  // On the home page, the links stay in the page. The 404 test covers the links of another page.
  expect(hrefs).toEqual(["#workflow", "#features", "#local", "#install", "#faq"]);
  for (const href of hrefs) await expect(page.locator(href)).toHaveCount(1);
  test.skip(!testInfo.project.name.startsWith("desktop"), "The phone header has no section links.");
  for (const [name, heading] of [
    ["Local", "#local-title"],
    ["FAQ", "#faq-title"],
  ] as const) {
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name })
      .click();
    await expect(page.locator(heading)).toBeInViewport();
    const headerBottom = await page
      .locator("[data-site-header]")
      .evaluate((header) => header.getBoundingClientRect().bottom);
    const headingTop = await page
      .locator(heading)
      .evaluate((element) => element.getBoundingClientRect().top);
    expect(headingTop).toBeGreaterThanOrEqual(headerBottom);
  }
});

test("the opening links to each terminal install below the sticky header", async ({ page }) => {
  const installs = page.getByRole("list", { name: "Install from a terminal" });
  for (const [name, id] of [
    ["macOS and Linux", "unix"],
    ["Windows", "windows"],
    ["Homebrew", "brew"],
  ] as const) {
    await installs.getByRole("link", { name }).click();
    await expect(page).toHaveURL(new RegExp(`#install-${id}$`));
    const terminal = page.locator(`#install-${id}`);
    await expect(terminal).toHaveText(name);
    await expect(terminal).toBeInViewport();
    const headerBottom = await page
      .locator("[data-site-header]")
      .evaluate((header) => header.getBoundingClientRect().bottom);
    const terminalTop = await terminal.evaluate((element) => element.getBoundingClientRect().top);
    expect(terminalTop).toBeGreaterThanOrEqual(headerBottom);
  }
});

test("light is the default even on dark systems; the switch changes the page and the product views", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  const body = page.locator("body");
  const card = page.locator(".hero .card").first();
  const background = (element: Element) => getComputedStyle(element).backgroundColor;
  const lightPage = await body.evaluate(background);
  const lightCard = await card.evaluate(background);
  // The scroll bars and the form controls follow the page theme, not the system.
  const scheme = () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
  expect(await scheme()).toBe("light");
  await expect(page.getByRole("button", { name: "Use dark theme" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await expect(page.getByRole("button", { name: "Use light theme" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(await body.evaluate(background)).not.toBe(lightPage);
  expect(await card.evaluate(background)).not.toBe(lightCard);
  expect(await scheme()).toBe("dark");
  await page.reload();
  await expect(page.getByRole("button", { name: "Use dark theme" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(await card.evaluate(background)).toBe(lightCard);
});

test("text can double in size without a horizontal page scroll", async ({ page }) => {
  await page.evaluate(() => document.fonts.ready);
  for (const size of ["100%", "200%"]) {
    await page.evaluate((fontSize) => {
      document.documentElement.style.fontSize = fontSize;
    }, size);
    expect(await horizontalOverflow(page)).toBe(0);
  }
});

test("the page text outside the product views has enough contrast", async ({ page }) => {
  // The theme switch changes the colors with a transition.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation instanceof CSSTransition)
        .map((animation) => animation.finished),
    ),
  );
  const failures = await page.evaluate(() => {
    type Rgba = [number, number, number, number];
    const canvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!canvas) throw new Error("The contrast check needs a 2D canvas.");
    // The canvas converts each CSS color format to sRGB.
    const rgba = (color: string): Rgba => {
      canvas.clearRect(0, 0, 1, 1);
      canvas.fillStyle = color;
      canvas.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0, a = 0] = canvas.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const over = ([r, g, b, a]: Rgba, [br, bg, bb]: Rgba): Rgba => [
      r * a + br * (1 - a),
      g * a + bg * (1 - a),
      b * a + bb * (1 - a),
      1,
    ];
    const channel = (value: number): number => {
      const c = value / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const luminance = ([r, g, b]: Rgba): number =>
      0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const white: Rgba = [255, 255, 255, 1];
    const failures: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      // As in axe, separators and other text without letters or digits do not count.
      const ownText = [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && /[\p{L}\p{N}]/u.test(node.textContent ?? ""),
      );
      const box = element.getBoundingClientRect();
      if (!ownText || element.closest(".replica") || box.width <= 1 || box.height <= 1) continue;
      if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      // Blend the backgrounds from the element down to the first opaque one.
      const layers: Rgba[] = [];
      let opacity = 1;
      for (let node: Element | null = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        opacity *= Number(style.opacity);
        const layer = rgba(style.backgroundColor);
        if (layer[3] > 0) layers.push(layer);
        if (layer[3] === 1) break;
      }
      const background = layers.reduceRight((below, layer) => over(layer, below), white);
      const style = getComputedStyle(element);
      const [r, g, b, a] = rgba(style.color);
      const text = luminance(over([r, g, b, a * opacity], background));
      const base = luminance(background);
      const ratio = (Math.max(text, base) + 0.05) / (Math.min(text, base) + 0.05);
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) {
        failures.push(`${ratio.toFixed(2)}: ${element.textContent?.trim().slice(0, 40)}`);
      }
    }
    return failures;
  });
  expect(failures).toEqual([]);
});

test("the skip link and the questions work from the keyboard", async ({ page }) => {
  await page.reload();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  const question = page.locator(".faq-answers details").first();
  await question.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(question).toHaveAttribute("open", "");
  await expect(question.locator("p")).toBeVisible();
});

test("the local section names the files on disk, and the closing repeats the install actions", async ({
  page,
}) => {
  const local = page.locator("#local");
  await expect(local.locator(".icon-list li")).toHaveCount(4);
  await expect(local.locator(".icon-list")).toContainText("~/.openducktor/task-stores");
  await expect(local.locator(".icon-list")).toContainText("~/.openducktor/worktrees");
  await expect(local.getByRole("link", { name: "GitHub", exact: true })).toHaveAttribute(
    "href",
    links.github,
  );
  const closing = page.locator(".closing");
  await expect(closing.getByRole("link", { name: "Download", exact: true })).toHaveAttribute(
    "href",
    links.latest,
  );
  await expect(closing.locator(".command code")).toHaveText(commands.browser);
  await expect(closing.getByRole("link", { name: "Read the source on GitHub" })).toHaveAttribute(
    "href",
    links.github,
  );
});

test("each file in /_astro/ has a content hash in its name, so a browser can keep it", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await reload(page);
  const assets = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => new URL(entry.name).pathname)
      .filter((path) => path.startsWith("/_astro/")),
  );
  expect(assets).not.toHaveLength(0);
  // The _headers file caches these files for a year, so a changed file needs a new name.
  for (const path of assets) expect(path).toMatch(/\.[\w-]{8}\.[a-z0-9]+$/);
});

test("the page makes no third-party, analytics, or agent requests", async ({ page }) => {
  const unexpected: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.origin !== ORIGIN ||
      !["document", "stylesheet", "script", "font", "image"].includes(request.resourceType())
    )
      unexpected.push(`${request.resourceType()} ${request.url()}`);
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await reload(page);
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });
  expect(unexpected).toEqual([]);
});

test("the page scripts keep the GSAP license notices", async ({ page }) => {
  const scripts = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => name.endsWith(".js")),
  );
  const sources = await Promise.all(
    scripts.map(async (url) => (await page.request.get(url)).text()),
  );
  const notices = sources
    .join("\n")
    .match(/Subject to the terms at https:\/\/gsap\.com\/standard-license/g);
  // GSAP, CSSPlugin, Observer, and ScrollTrigger each have a notice.
  expect(notices).toHaveLength(4);
});

test("an unknown address shows the 404 page, which search engines do not index", async ({
  page,
}) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle("Page not found | OpenDucktor");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  // The header links lead to the sections of the home page.
  const workflow = page.locator(".site-nav a").first();
  await expect(workflow).toHaveAttribute("href", "/#workflow");
  await expect(page.getByRole("link", { name: "OpenDucktor home" })).toHaveAttribute(
    "href",
    "/#top",
  );
  // A page without product views loads no animation library.
  const scripts = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => name.endsWith(".js")),
  );
  expect(scripts).not.toHaveLength(0);
  const sources = await Promise.all(
    scripts.map(async (url) => (await page.request.get(url)).text()),
  );
  expect(sources.join("\n")).not.toContain("gsap.com/standard-license");
});

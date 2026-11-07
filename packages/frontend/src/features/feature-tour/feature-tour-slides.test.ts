import { expect, test } from "bun:test";
import type { AppPlatform } from "@openducktor/contracts";
import { buildFeatureTourSlides } from "./feature-tour-slides";

const paletteSlideText = (platform: AppPlatform): string | undefined =>
  buildFeatureTourSlides(platform).find((slide) => slide.id === "command-palette")?.text;

test("the slides write the command palette shortcut of the device", () => {
  expect(paletteSlideText("darwin")?.startsWith("Press ⌘K on any page")).toBe(true);
  expect(paletteSlideText("linux")?.startsWith("Press Ctrl+K on any page")).toBe(true);
});

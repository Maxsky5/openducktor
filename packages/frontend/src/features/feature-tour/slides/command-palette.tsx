import type { AppPlatform } from "@openducktor/contracts";
import { platformKeyLabels } from "@/lib/keyboard-shortcuts";
import { TourScene } from "../feature-tour-scenes";
import type { FeatureTourSlide } from "../feature-tour-stage";

/** The command palette shortcut as the slide text writes it: "⌘K" on macOS, "Ctrl+K" elsewhere. */
const commandPaletteShortcutLabel = (platform: AppPlatform): string => {
  const { modifier } = platformKeyLabels(platform);
  return platform === "darwin" ? `${modifier}K` : `${modifier}+K`;
};

/** Slide 6: the palette scene of the marketing website, with the keys of `platform`. */
export const commandPaletteSlide = (platform: AppPlatform): FeatureTourSlide => ({
  id: "command-palette",
  title: "Find anything with the command palette",
  text: `Press ${commandPaletteShortcutLabel(platform)} on any page to open the command palette. Find any task or session in all your workspaces, start its next step, or answer its agent.`,
  picture: <TourScene scene="palette" platform={platform} />,
});

import type { AppPlatform } from "@openducktor/contracts";
import { TourScene } from "../feature-tour-scenes";
import type { FeatureTourSlide } from "../feature-tour-stage";

/** Slide 1: the hero scene of the marketing website, with the keys of `platform`. */
export const welcomeSlide = (platform: AppPlatform): FeatureTourSlide => ({
  id: "welcome",
  title: "Welcome to OpenDucktor",
  text: "OpenDucktor runs your coding agents on your computer: Codex, Claude Code, and OpenCode. They write the spec and the plan, build each task in its own Git worktree, and pass a QA review before yours.",
  picture: <TourScene scene="hero" platform={platform} />,
});

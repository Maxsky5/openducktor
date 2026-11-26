import type { AppPlatform } from "@openducktor/contracts";
import { TourScene } from "../feature-tour-scenes";
import type { FeatureTourSlide } from "../feature-tour-stage";

/** Slide 5: the workflow editor scene of the marketing website. */
export const workflowsSlide = (platform: AppPlatform): FeatureTourSlide => ({
  id: "workflows",
  title: "Make the workflow yours",
  text: "Open Workflows at the bottom of the sidebar. Copy the built-in workflow or start blank. Add columns, buttons, and agents, then publish a version for the repositories that you choose.",
  picture: <TourScene scene="workflow-editor" platform={platform} />,
});

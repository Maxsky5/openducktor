import type { AppPlatform } from "@openducktor/contracts";
import type { FeatureTourSlide } from "./feature-tour-stage";
import { commandPaletteSlide } from "./slides/command-palette";
import { issueTypesSlide } from "./slides/issue-types";
import { remoteControlSlide } from "./slides/remote-control";
import { reviewSlide } from "./slides/review";
import { rolesSlide } from "./slides/roles";
import { sessionsSlide } from "./slides/sessions";
import { welcomeSlide } from "./slides/welcome";
import { workspacesSlide } from "./slides/workspaces";

/** The ordered tour slides. Only the keys that the slides show depend on the device. */
export const buildFeatureTourSlides = (platform: AppPlatform): FeatureTourSlide[] => [
  welcomeSlide(platform),
  workspacesSlide(platform),
  issueTypesSlide,
  rolesSlide,
  sessionsSlide,
  commandPaletteSlide(platform),
  remoteControlSlide,
  reviewSlide,
];

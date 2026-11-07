import type { SceneBuilder } from "../../motion/scene";
import { build as buildStep } from "./build";
import { plan } from "./plan";
import { qa } from "./qa";
import { review } from "./review";
import type { ChapterId } from "./sample";
import { spec } from "./spec";

/** The scene of each workflow step. Each step starts where the step before it ends. */
export const build = {
  spec,
  plan,
  build: buildStep,
  qa,
  review,
} as const satisfies Record<ChapterId, SceneBuilder<string>>;

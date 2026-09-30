import { mountChapters } from "../../motion/chapters";
import { must } from "../../motion/dom";
import type { SceneBuilder } from "../../motion/scene";
import { build } from "./build";
import type { ChapterId } from "./chapters";
import { plan } from "./plan";
import { qa } from "./qa";
import { review } from "./review";
import { spec } from "./spec";

/** The scene of each workflow step. Each step starts where the step before it ends. */
const BUILDERS = { spec, plan, build, qa, review } satisfies Record<
  ChapterId,
  SceneBuilder<string>
>;

export function mountWorkflow(): void {
  mountChapters(must(document, '[data-chapters="workflow"]'), new Map(Object.entries(BUILDERS)));
}

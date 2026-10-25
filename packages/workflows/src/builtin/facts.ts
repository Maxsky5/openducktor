import { createTaskInputs } from "../task-workflow/task-input";
import type { BuiltinTaskCard } from "./task-card";
import { builtinWorkflow } from "./definition";

export type BuiltinTask = Pick<BuiltinTaskCard, "id" | "status" | "issueType" | "artifactSummary">;

const inputs = createTaskInputs(builtinWorkflow.definition);

/** A summary in which no workflow artifact is present. */
export const emptyArtifactSummary = inputs.emptyArtifactSummary;

/** The task artifact summary is the artifact input. Extra entry fields do not affect evaluation. */
export const builtinTaskInput = inputs.input;

/** Task lists reuse evaluation results for tasks with equal inputs. */
export const cachedByTaskInput = inputs.cached;

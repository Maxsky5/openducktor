// The task card of the product in Human Review that the tests of the approval scenes give to the
// rules of the app.
import { importProduct } from "./product-source";

/** The workflow of a task card, as the tests read it. */
export type TaskWorkflow = { createsPullRequest: (role: string) => boolean };
/** A task card of the product, with the fields that the tests read. */
export type TaskCard = { id: string; taskWorkflow: TaskWorkflow };
type ArtifactState = { present: boolean; verdict?: string };

// SAFETY: the test support of the workflows exports these fixtures.
const workflowSupport = await importProduct<{
  createTaskCardFixture: (overrides: {
    id: string;
    issueType: string;
    status: string;
    artifactSummary: Record<string, ArtifactState>;
  }) => TaskCard;
  emptyArtifactSummary: () => Record<string, ArtifactState>;
}>("packages/workflows/test-support/index.ts");

/** The feature task `id` in Human Review, with each artifact and an approved QA report. */
export function reviewTask(id: string): TaskCard {
  const artifacts: Record<string, ArtifactState> = {};
  for (const code of Object.keys(workflowSupport.emptyArtifactSummary())) {
    artifacts[code] =
      code === "qaReport" ? { present: true, verdict: "approved" } : { present: true };
  }
  return workflowSupport.createTaskCardFixture({
    id,
    issueType: "feature",
    status: "human_review",
    artifactSummary: artifacts,
  });
}

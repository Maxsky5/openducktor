import { readFileSync } from "node:fs";
import {
  agentRoleSchema,
  agentToolNameSchema,
  issueTypeSchema,
  taskStatusSchema,
} from "@openducktor/contracts";
import { z } from "zod";

const workflowContractFixtureSchema = z
  .object({
    roles: z.record(agentRoleSchema, z.array(agentToolNameSchema)),
    tools: z.array(agentToolNameSchema),
    statuses: z.array(taskStatusSchema),
    transitions: z.record(issueTypeSchema, z.record(taskStatusSchema, z.array(taskStatusSchema))),
    setSpecAllowedStatuses: z.array(taskStatusSchema),
    setPlanAllowedStatuses: z.record(issueTypeSchema, z.array(taskStatusSchema)),
    resetImplementationAllowedStatuses: z.array(taskStatusSchema),
    resetTaskAllowedStatuses: z.array(taskStatusSchema),
    epicSubtaskReplacementAllowedStatuses: z.array(taskStatusSchema),
  })
  .strict();

export const loadWorkflowContractFixture = () =>
  workflowContractFixtureSchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../../../../docs/contracts/workflow-contract-fixture.json", import.meta.url),
        "utf8",
      ),
    ),
  );

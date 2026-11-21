import { describe, expect, test } from "bun:test";
import { ODT_WORKFLOW_AGENT_TOOL_NAMES } from "@openducktor/contracts";
import { specPlanBuildWorkflow } from "./workflow";
import { builtinRole, BUILTIN_ROLES } from "../roles/roles";
import { loadWorkflowContractFixture } from "../../../test-support/workflow-contract-fixture";

describe("agent orchestrator role policy contract", () => {
  test("keeps workflow code writes within each role's responsibility", () => {
    expect(
      Object.fromEntries(
        specPlanBuildWorkflow.definition.roles.map(({ id, writes }) => [id, writes]),
      ),
    ).toEqual({
      spec: ["spec"],
      planner: ["plan"],
      build: ["spec", "plan"],
      qa: ["qaReport"],
    });
  });
  test("matches the workflow tool catalog", () => {
    const fixture = loadWorkflowContractFixture();
    expect([...fixture.tools].sort()).toEqual([...ODT_WORKFLOW_AGENT_TOOL_NAMES].sort());
    const grantedTools = new Set(BUILTIN_ROLES.flatMap((role) => role.tools));
    expect([...grantedTools].sort()).toEqual([...fixture.tools].sort());
  });

  test("keeps odt_set_pull_request restricted to Builder sessions", () => {
    expect(builtinRole("build").tools).toContain("odt_set_pull_request");
    expect(builtinRole("spec").tools).not.toContain("odt_set_pull_request");
    expect(builtinRole("planner").tools).not.toContain("odt_set_pull_request");
    expect(builtinRole("qa").tools).not.toContain("odt_set_pull_request");
  });

  test("lets every workflow role read task data", () => {
    for (const { tools } of BUILTIN_ROLES) {
      expect(tools).toContain("odt_read_task");
      expect(tools).toContain("odt_read_task_assets");
      expect(tools).toContain("odt_read_task_artifacts");
    }
  });

  test("lets every workflow role search and create tasks", () => {
    for (const { tools } of BUILTIN_ROLES) {
      expect(tools).toContain("odt_search_tasks");
      expect(tools).toContain("odt_create_task");
    }
  });

  test("lets every workflow role update task fields", () => {
    for (const { tools } of BUILTIN_ROLES) {
      expect(tools).toContain("odt_update_task");
    }
  });
});

import { describe, expect, test } from "bun:test";
import { AGENT_ROLE_TOOL_POLICY } from "./agent-orchestrator";
import { loadWorkflowContractFixture } from "./workflow-contract-fixture.test-support";

describe("agent orchestrator role policy contract", () => {
  test("matches canonical workflow fixture", () => {
    const fixture = loadWorkflowContractFixture();
    expect(AGENT_ROLE_TOOL_POLICY).toEqual(fixture.roles);
  });

  test("keeps odt_set_pull_request restricted to Builder sessions", () => {
    expect(AGENT_ROLE_TOOL_POLICY.build).toContain("odt_set_pull_request");
    expect(AGENT_ROLE_TOOL_POLICY.spec).not.toContain("odt_set_pull_request");
    expect(AGENT_ROLE_TOOL_POLICY.planner).not.toContain("odt_set_pull_request");
    expect(AGENT_ROLE_TOOL_POLICY.qa).not.toContain("odt_set_pull_request");
  });

  test("lets every workflow role read referenced task description assets", () => {
    for (const tools of Object.values(AGENT_ROLE_TOOL_POLICY)) {
      expect(tools).toContain("odt_read_task_assets");
    }
  });
});

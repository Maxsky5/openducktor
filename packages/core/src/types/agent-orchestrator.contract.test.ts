import { describe, expect, test } from "bun:test";
import { ODT_WORKFLOW_AGENT_TOOL_NAMES } from "@openducktor/contracts";
import { AGENT_ROLE_TOOL_POLICY } from "./agent-orchestrator";
import { loadWorkflowContractFixture } from "./workflow-contract-fixture.test-support";

describe("agent orchestrator role policy contract", () => {
  test("matches canonical workflow fixture", () => {
    const fixture = loadWorkflowContractFixture();
    expect(AGENT_ROLE_TOOL_POLICY).toEqual(fixture.roles);
  });

  test("matches the workflow tool catalog", () => {
    const fixture = loadWorkflowContractFixture();
    expect([...fixture.tools].sort()).toEqual([...ODT_WORKFLOW_AGENT_TOOL_NAMES].sort());
    const grantedTools = new Set(Object.values(AGENT_ROLE_TOOL_POLICY).flat());
    expect([...grantedTools].sort()).toEqual([...fixture.tools].sort());
  });

  test("keeps odt_set_pull_request restricted to Builder sessions", () => {
    expect(AGENT_ROLE_TOOL_POLICY.build).toContain("odt_set_pull_request");
    expect(AGENT_ROLE_TOOL_POLICY.spec).not.toContain("odt_set_pull_request");
    expect(AGENT_ROLE_TOOL_POLICY.planner).not.toContain("odt_set_pull_request");
    expect(AGENT_ROLE_TOOL_POLICY.qa).not.toContain("odt_set_pull_request");
  });

  test("lets every workflow role read task data", () => {
    for (const tools of Object.values(AGENT_ROLE_TOOL_POLICY)) {
      expect(tools).toContain("odt_read_task");
      expect(tools).toContain("odt_read_task_assets");
      expect(tools).toContain("odt_read_task_documents");
    }
  });

  test("lets every workflow role search and create tasks", () => {
    for (const tools of Object.values(AGENT_ROLE_TOOL_POLICY)) {
      expect(tools).toContain("odt_search_tasks");
      expect(tools).toContain("odt_create_task");
    }
  });

  test("lets every workflow role update task fields", () => {
    for (const tools of Object.values(AGENT_ROLE_TOOL_POLICY)) {
      expect(tools).toContain("odt_update_task");
    }
  });
});

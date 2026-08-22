import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_ROLE_TOOL_POLICY } from "./agent-orchestrator";

type WorkflowContractFixture = {
  roles: Record<string, string[]>;
};

const loadFixture = (): WorkflowContractFixture => {
  const fixturePath = join(
    import.meta.dir,
    "../../../../docs/contracts/workflow-contract-fixture.json",
  );
  const raw = readFileSync(fixturePath, "utf8");
  // SAFETY: This test controls the fixture and supplies `WorkflowContractFixture` used by this case.
  return JSON.parse(raw) as WorkflowContractFixture;
};

describe("agent orchestrator role policy contract", () => {
  test("matches canonical workflow fixture", () => {
    const fixture = loadFixture();
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

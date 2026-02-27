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
  return JSON.parse(raw) as WorkflowContractFixture;
};

describe("agent orchestrator role policy contract", () => {
  test("matches canonical workflow fixture", () => {
    const fixture = loadFixture();
    expect(AGENT_ROLE_TOOL_POLICY).toEqual(fixture.roles);
  });
});

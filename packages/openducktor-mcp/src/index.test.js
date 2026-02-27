import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ODT_REGISTERED_TOOL_NAMES, registerOdtTool } from "./index";
import { ODT_TOOL_SCHEMAS } from "./lib";

const loadWorkflowFixture = () => {
  const fixturePath = join(
    import.meta.dir,
    "../../../docs/contracts/workflow-contract-fixture.json",
  );
  return JSON.parse(readFileSync(fixturePath, "utf8"));
};

describe("registerOdtTool", () => {
  test("binds registerTool to server context", () => {
    let capturedName = null;

    const fakeServer = {
      _registeredTools: [],
      registerTool(name, _config, _handler) {
        this._registeredTools.push(name);
        capturedName = name;
      },
    };

    expect(() =>
      registerOdtTool(
        fakeServer,
        {},
        {
          name: "odt_read_task",
          description: "Read task",
          execute: async () => ({ ok: true }),
        },
      ),
    ).not.toThrow();

    expect(capturedName).toBe("odt_read_task");
    expect(fakeServer._registeredTools).toEqual(["odt_read_task"]);
  });

  test("keeps registered tools in sync with MCP schema keys", () => {
    const schemaToolNames = Object.keys(ODT_TOOL_SCHEMAS);
    expect(ODT_REGISTERED_TOOL_NAMES).toEqual(schemaToolNames);
  });

  test("matches canonical workflow fixture tool list", () => {
    const fixture = loadWorkflowFixture();
    expect(ODT_REGISTERED_TOOL_NAMES).toEqual(fixture.tools);
  });
});

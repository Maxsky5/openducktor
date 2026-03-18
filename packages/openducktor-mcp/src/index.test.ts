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

  test("registers MCP input schema using tool shape entries", () => {
    let capturedConfig = null;

    const fakeServer = {
      registerTool(_name, config, _handler) {
        capturedConfig = config;
      },
    };

    registerOdtTool(
      fakeServer,
      {},
      {
        name: "odt_read_task",
        description: "Read task",
        execute: async () => ({ ok: true }),
      },
    );

    expect(capturedConfig).not.toBeNull();
    expect(Object.keys(capturedConfig.inputSchema)).toEqual(
      Object.keys(ODT_TOOL_SCHEMAS.odt_read_task.shape),
    );
    expect(typeof capturedConfig.inputSchema.taskId.parse).toBe("function");
  });

  test("rejects invalid input schema shape before registering tool", () => {
    const originalSchema = ODT_TOOL_SCHEMAS.odt_read_task;

    ODT_TOOL_SCHEMAS.odt_read_task = {
      shape: { taskId: {} },
      parse: (input) => input,
    };

    try {
      const fakeServer = {
        registerTool() {},
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
      ).toThrow("Invalid MCP input schema for tool 'odt_read_task'.");
    } finally {
      ODT_TOOL_SCHEMAS.odt_read_task = originalSchema;
    }
  });

  test("returns tool error envelope when execution throws", async () => {
    let capturedHandler = null;

    const fakeServer = {
      registerTool(_name, _config, handler) {
        capturedHandler = handler;
      },
    };

    registerOdtTool(
      fakeServer,
      {},
      {
        name: "odt_read_task",
        description: "Read task",
        execute: async () => {
          throw new Error("Task exploded");
        },
      },
    );

    const result = await capturedHandler({ taskId: "task-1" });
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: false,
              error: {
                code: "ODT_TOOL_EXECUTION_ERROR",
                message: "Task exploded",
              },
            },
            null,
            2,
          ),
        },
      ],
      structuredContent: {
        ok: false,
        error: {
          code: "ODT_TOOL_EXECUTION_ERROR",
          message: "Task exploded",
        },
      },
      isError: true,
    });
  });

  test("returns tool error envelope when input fails schema parsing", async () => {
    let capturedHandler = null;

    const fakeServer = {
      registerTool(_name, _config, handler) {
        capturedHandler = handler;
      },
    };

    registerOdtTool(
      fakeServer,
      {},
      {
        name: "odt_read_task",
        description: "Read task",
        execute: async () => ({ ok: true }),
      },
    );

    const result = await capturedHandler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      ok: false,
      error: {
        code: "ODT_TOOL_INPUT_INVALID",
      },
    });
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: {
        code: "ODT_TOOL_INPUT_INVALID",
      },
    });
  });

  test("keeps registered tools in sync with MCP schema keys", () => {
    const schemaToolNames = Object.keys(ODT_TOOL_SCHEMAS);
    expect([...ODT_REGISTERED_TOOL_NAMES].sort()).toEqual([...schemaToolNames].sort());
  });

  test("keeps workflow-prefixed registered tools aligned with the canonical workflow fixture", () => {
    const fixture = loadWorkflowFixture();
    expect(ODT_REGISTERED_TOOL_NAMES.filter((toolName) => toolName.startsWith("odt_"))).toEqual(
      fixture.tools,
    );
  });
});

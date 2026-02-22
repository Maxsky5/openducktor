import { describe, expect, test } from "bun:test";
import { registerOdtTool } from "./index";

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
});

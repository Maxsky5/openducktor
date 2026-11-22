import { describe, expect, test } from "bun:test";
import type { InitializeResponse } from "@agentclientprotocol/sdk/unstable";
import {
  checkAntigravityAgentContract,
  describeAntigravityRequestError,
} from "./antigravity-native-contract";

const initializeResult = (overrides: Partial<InitializeResponse> = {}): InitializeResponse => ({
  protocolVersion: 1,
  agentCapabilities: {
    loadSession: true,
    sessionCapabilities: { list: {}, close: {} },
    _meta: { antigravity: { systemPrompt: { append: true } } },
  },
  agentInfo: { name: "Antigravity ACP Server", version: "1.5.14" },
  ...overrides,
});

describe("checkAntigravityAgentContract", () => {
  test("accepts the checked Antigravity CLI", () => {
    expect(checkAntigravityAgentContract(initializeResult())).toBeNull();
  });

  test("refuses an ACP protocol version other than 1", () => {
    expect(checkAntigravityAgentContract(initializeResult({ protocolVersion: 2 }))).toBe(
      "Antigravity answered with ACP protocol version 2, and OpenDucktor needs version 1.",
    );
  });

  test("names the installed and required versions of an old CLI", () => {
    const result = checkAntigravityAgentContract(
      initializeResult({ agentInfo: { name: "Antigravity ACP Server", version: "1.4.0" } }),
    );
    expect(result).toBe(
      "OpenDucktor needs Antigravity CLI 1.5.14 or later. Version 1.4.0 is installed.",
    );
  });

  test("names each missing capability", () => {
    const result = checkAntigravityAgentContract(
      initializeResult({ agentCapabilities: { loadSession: true, sessionCapabilities: {} } }),
    );
    expect(result).toBe(
      "Antigravity CLI 1.5.14 does not support session/list, session/close, the system prompt extension.",
    );
  });
});

describe("describeAntigravityRequestError", () => {
  test("tells the user to sign in when the runtime needs authentication", () => {
    const error = Object.assign(new Error("Authentication required"), { code: -32000 });
    expect(describeAntigravityRequestError(error)).toContain("run `agy` in a terminal");
  });
});

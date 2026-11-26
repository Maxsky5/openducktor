import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveOpenCodeGlobalConfigDirectory } from "./opencode-standalone-process";

test.each([
  [{ OPENCODE_CONFIG_DIR: "/custom/opencode", XDG_CONFIG_HOME: "/xdg" }, "/custom/opencode"],
  // OpenCode joins the path with the separator of the platform.
  [{ XDG_CONFIG_HOME: "/xdg" }, join("/xdg", "opencode")],
  [{ XDG_CONFIG_HOME: "" }, join(homedir(), ".config", "opencode")],
  [{ OPENCODE_CONFIG_DIR: "", XDG_CONFIG_HOME: "/xdg" }, join("/xdg", "opencode")],
  [{}, join(homedir(), ".config", "opencode")],
])("resolves the OpenCode global config directory for %p", (env, directory) => {
  expect(resolveOpenCodeGlobalConfigDirectory(env)).toBe(directory);
});

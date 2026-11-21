import { describe, expect, test } from "bun:test";
import type { LiveProcess } from "../../ports/process-inspector-port";
import {
  browserTarget,
  decodeProcessRef,
  encodeProcessRef,
  isAgentRuntimeServer,
  isIdleInteractiveShell,
  processCommandLine,
  processDisplayName,
} from "./workspace-process-rules";

const live = (executable: string, args: string[]): LiveProcess => ({
  pid: 10,
  parentPid: 1,
  identity: "1",
  name: executable,
  executable,
  arguments: args,
});

describe("isAgentRuntimeServer", () => {
  test.each([
    ["/Users/me/.opencode/bin/opencode", ["opencode", "serve", "--stdio", "--port", "0"]],
    ["/Users/me/.opencode/bin/opencode", ["opencode", "serve", "--service"]],
    ["/usr/local/bin/codex", ["codex", "app-server"]],
    [
      "/Users/me/.local/share/claude/versions/2.1.330",
      [
        "/Users/me/.local/bin/claude",
        "--output-format",
        "stream-json",
        "--input-format",
        "stream-json",
      ],
    ],
  ])("treats %s %j as an agent runtime", (executable, args) => {
    expect(isAgentRuntimeServer(live(executable, args))).toBe(true);
  });

  test.each([
    ["/Users/me/.opencode/bin/opencode", ["opencode"]],
    ["/usr/local/bin/codex", ["codex", "exec", "fix the build"]],
    ["/Users/me/.local/share/claude/versions/2.1.330", ["/Users/me/.local/bin/claude"]],
    ["/usr/local/bin/node", ["node", "serve"]],
  ])("treats %s %j as a command", (executable, args) => {
    expect(isAgentRuntimeServer(live(executable, args))).toBe(false);
  });
});

describe("isIdleInteractiveShell", () => {
  test.each([
    ["/bin/zsh", ["-zsh"]],
    ["/bin/zsh", ["zsh", "-l"]],
    ["/bin/bash", ["bash", "--init-file", "/tmp/odt/bashrc", "-i"]],
    ["/usr/bin/fish", ["fish", "--init-command", "source hooks"]],
    ["C:\\Program Files\\PowerShell\\7\\pwsh.exe", ["pwsh", "-NoLogo"]],
    ["C:\\Windows\\System32\\cmd.exe", ["cmd"]],
  ])("treats %s %j as idle", (executable, args) => {
    expect(isIdleInteractiveShell(live(executable, args))).toBe(true);
  });

  test.each([
    ["/bin/zsh", ["zsh", "-c", "bun dev"]],
    ["/bin/bash", ["bash", "-lc", "make serve"]],
    ["/bin/sh", ["sh", "scripts/dev.sh"]],
    ["C:\\Program Files\\PowerShell\\7\\pwsh.exe", ["pwsh", "-NoLogo", "-Command", "bun dev"]],
    ["C:\\Windows\\System32\\cmd.exe", ["cmd", "/c", "bun dev"]],
    ["/usr/local/bin/node", ["node", "server.js"]],
  ])("keeps %s %j", (executable, args) => {
    expect(isIdleInteractiveShell(live(executable, args))).toBe(false);
  });
});

describe("browserTarget", () => {
  test("maps wildcard addresses to loopback and suggests HTTP for an unknown server", () => {
    const node = live("/usr/bin/node", ["node", "server.js"]);
    expect(browserTarget(node, { address: "0.0.0.0", port: 3000 })).toEqual({
      kind: "link",
      url: "http://127.0.0.1:3000/",
      suggested: true,
    });
    expect(browserTarget(node, { address: "::", port: 3000 })).toMatchObject({
      url: "http://[::1]:3000/",
    });
    expect(browserTarget(node, { address: "127.0.0.1", port: 6000 })).toMatchObject({
      kind: "unavailable",
    });
  });

  test.each([
    [["python3", "-m", "http.server", "--tls-cert", "c.pem"], "https"],
    [["python3", "-m", "http.server", "--tls-cert=c.pem"], "https"],
    [["python3", "-m", "http.server", "--tls-c", "c.pem"], "https"],
    [["python3", "-m", "http.server", "--tls-key", "k.pem"], "http"],
    [["python3", "-m", "http.server", "--", "--tls-cert"], "http"],
  ])("reads the scheme of http.server %j", (args, scheme) => {
    expect(
      browserTarget(live("/usr/bin/python3", args), { address: "127.0.0.1", port: 8443 }),
    ).toEqual({ kind: "link", url: `${scheme}://127.0.0.1:8443/`, suggested: false });
  });

  test("uses documented server evidence", () => {
    expect(
      browserTarget(
        live("/usr/bin/python3.14", ["python3", "-m", "http.server", "--tls-cert", "c.pem"]),
        {
          address: "127.0.0.1",
          port: 8443,
        },
      ),
    ).toEqual({ kind: "link", url: "https://127.0.0.1:8443/", suggested: false });
    expect(
      browserTarget(live("/opt/postgres/bin/postgres", ["postgres", "-D", "data"]), {
        address: "127.0.0.1",
        port: 5432,
      }),
    ).toEqual({ kind: "non_web" });
  });
});

test("process references hold the PID and the lossless identity", () => {
  const instance = { pid: 42, identity: "18446744073709551615" };
  expect(decodeProcessRef(encodeProcessRef(instance))).toEqual(instance);
  expect(decodeProcessRef("not-a-ref")).toBeNull();
  expect(decodeProcessRef("0:1")).toBeNull();
});

test("shows the first argument as the process name, as ps does", () => {
  const claude = live("/Users/me/.local/share/claude/versions/2.1.326", ["claude", "--resume"]);
  expect(processDisplayName(claude)).toBe("claude");
  expect(processDisplayName(live("/bin/zsh", ["-zsh"]))).toBe("zsh");
  expect(processDisplayName({ pid: 3, parentPid: 1, identity: "3", name: "node" })).toBe("node");
});

test("shows the command line with the program name and quoted arguments", () => {
  const vite = live("/usr/local/bin/node", [
    "/usr/local/bin/node",
    "/repo/node_modules/.bin/vite",
    "--port",
    "5173",
    "--open",
    "My App",
  ]);
  expect(processCommandLine(vite)).toBe(
    'node /repo/node_modules/.bin/vite --port 5173 --open "My App"',
  );
  expect(processCommandLine({ pid: 3, parentPid: 1, identity: "3", name: "node" })).toBe("node");
});

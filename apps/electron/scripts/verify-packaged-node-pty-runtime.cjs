const { createRequire } = require("node:module");
const { join } = require("node:path");

const nodePtyRoot = process.argv[2];
if (!nodePtyRoot) throw new Error("Expected the packaged node-pty module root.");
const packagedRequire = createRequire(join(nodePtyRoot, "package.json"));
const nodePty = packagedRequire("node-pty");
const shell = process.platform === "win32" ? process.env.ComSpec : "/bin/sh";
if (!shell) throw new Error("The packaged node-pty probe could not resolve a shell.");
const args =
  process.platform === "win32"
    ? ["/d", "/s", "/c", "echo OPENDUCKTOR_NODE_PTY_OK"]
    : ["-c", "printf OPENDUCKTOR_NODE_PTY_OK"];

let transcript = "";
const terminal = nodePty.spawn(shell, args, {
  cols: 80,
  cwd: process.cwd(),
  encoding: null,
  env: process.env,
  name: "xterm-256color",
  rows: 24,
});
terminal.onData((data) => {
  transcript += Buffer.isBuffer(data) ? data.toString("utf8") : data;
});
const timeout = setTimeout(() => {
  terminal.kill();
  throw new Error("Packaged node-pty runtime probe timed out.");
}, 5_000);
terminal.onExit(({ exitCode }) => {
  clearTimeout(timeout);
  if (exitCode !== 0 || !transcript.includes("OPENDUCKTOR_NODE_PTY_OK")) {
    throw new Error(
      `Packaged node-pty runtime probe failed (exit ${exitCode}): ${JSON.stringify(transcript)}`,
    );
  }
  console.log("Packaged node-pty runtime probe passed.");
});

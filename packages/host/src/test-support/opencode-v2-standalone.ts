import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFakeRuntimeCommand } from "./fake-runtime-command";
import { removeTestDirectory } from "./temp-directory";
import { z } from "zod";

/** A real child and authenticated HTTP endpoint for the standalone lease contract. */
export const createFakeOpenCodeV2 = async (
  mode: "valid" | "v1" | "malformed" | "silent" | "exit" = "valid",
) => {
  const directory = await mkdtemp(join(tmpdir(), "odt-v2-standalone-"));
  const recordPath = join(directory, "record.json");
  await writeFile(
    join(directory, "server.cjs"),
    `
const http = require("node:http");
const fs = require("node:fs");
const mode = ${JSON.stringify(mode)};
const record = { args: process.argv.slice(2), config: process.env.OPENCODE_CONFIG_CONTENT, marker: process.env.ODT_TEST_MARKER, passwordLength: process.env.OPENCODE_PASSWORD?.length, requests: [] };
const save = () => fs.writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify(record));
save();
if (mode === "exit") { process.stderr.write("native startup failed"); process.exit(2); }
const server = http.createServer((req, res) => {
  const authorized = req.headers.authorization === "Basic " + Buffer.from("opencode:" + process.env.OPENCODE_PASSWORD).toString("base64");
  record.requests.push({ path: req.url, authorized }); save();
  res.setHeader("content-type", "application/json");
  if (!authorized) { res.writeHead(401); res.end("{}"); return; }
  if (req.url === "/api/info") { res.end(JSON.stringify({ version: mode === "v1" ? "1.18.35" : "2.0.24", pid: process.pid, urls: [], paths: { tmp: ${JSON.stringify(directory)} } })); return; }
  if (req.url === "/api/event") { res.setHeader("content-type", "text/event-stream"); res.write('data: ' + JSON.stringify({ id: "connected", type: "server.connected", data: {} }) + '\\n\\n'); return; }
  if (req.url === "/api/rpc/openducktor-workflow-instructions/bind" && req.method === "POST") { res.end(JSON.stringify({ output: { ready: true } })); return; }
  if (req.url === "/api/experimental/migration/v1") { res.end(JSON.stringify({ status: "completed" })); return; }
  if (req.url === "/api/session/external-session-1") { res.end(JSON.stringify({ data: { id: "external-session-1", location: { directory: "/repo/worktree" }, projectID: "project-1", cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 1, updated: 2 } } })); return; }
  if (req.url === "/api/session/external-session-1/interrupt" && req.method === "POST") { res.end(JSON.stringify({ interrupted: true })); return; }
  if (req.url === "/api/session/active") { res.end(JSON.stringify({ data: {} })); return; }
  res.writeHead(404); res.end("{}");
});
server.listen(0, "127.0.0.1", () => {
  if (mode === "silent") return;
  const line = mode === "malformed" ? "OpenCode server listening\\n" : JSON.stringify({ url: "http://127.0.0.1:" + server.address().port }) + "\\n";
  process.stdout.write(line.slice(0, 5));
  setImmediate(() => process.stdout.write(line.slice(5)));
});
process.stdin.resume();
process.stdin.on("end", () => server.close(() => process.exit(0)));
`,
  );
  const executablePath = await writeFakeRuntimeCommand(directory, "opencode", "server.cjs");
  return {
    directory,
    executablePath,
    readRecord: async () =>
      z
        .object({
          args: z.array(z.string()),
          config: z.string().optional(),
          marker: z.string().optional(),
          passwordLength: z.number(),
          requests: z.array(z.object({ path: z.string(), authorized: z.boolean() })),
        })
        .parse(JSON.parse(await readFile(recordPath, "utf8"))),
    cleanup: () => removeTestDirectory(directory),
  };
};

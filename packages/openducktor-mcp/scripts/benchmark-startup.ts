import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ODT_TOOL_SCHEMAS } from "@openducktor/contracts";

type RecordedRequest = {
  path: string;
  body: unknown;
};

type StartupSample = {
  durationMs: number;
  requests: RecordedRequest[];
};

const cliArgs = process.argv.slice(2);

const readOption = (name: string): string => {
  const index = cliArgs.indexOf(name);
  const value = index >= 0 ? cliArgs[index + 1] : undefined;
  if (!value) {
    throw new Error(`Missing required ${name} option.`);
  }
  return value;
};

const readSampleCount = (): number => {
  const index = cliArgs.indexOf("--samples");
  if (index < 0) {
    return 30;
  }
  const value = Number(cliArgs[index + 1]);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("--samples must be a positive integer.");
  }
  return value;
};

const baselineEntrypoint = resolve(readOption("--baseline"));
const currentEntrypoint = resolve(readOption("--current"));
const sampleCount = readSampleCount();

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf8").trim();
  return body.length === 0 ? {} : JSON.parse(body);
};

const writeJson = (response: ServerResponse, payload: unknown): void => {
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
};

const requests: RecordedRequest[] = [];
const server = createServer(async (request, response) => {
  const path = request.url ?? "/";
  requests.push({ path, body: await readJsonBody(request) });

  if (path === "/health") {
    writeJson(response, { ok: true });
    return;
  }
  if (path === "/invoke/odt_mcp_ready") {
    writeJson(response, {
      bridgeVersion: 1,
      toolNames: Object.keys(ODT_TOOL_SCHEMAS),
    });
    return;
  }
  if (path === "/invoke/odt_get_workspaces") {
    writeJson(response, {
      workspaces: [
        {
          workspaceId: "repo",
          workspaceName: "Repo",
          repoPath: "/repo",
          isActive: true,
          hasConfig: true,
          configuredWorktreeBasePath: null,
          defaultWorktreeBasePath: null,
          effectiveWorktreeBasePath: null,
        },
      ],
    });
    return;
  }

  response.statusCode = 404;
  writeJson(response, { error: `Unexpected bridge path: ${path}` });
});

const listen = async (): Promise<string> => {
  await new Promise<void>((resolveListen, reject) => {
    server.listen(0, "127.0.0.1", resolveListen);
    server.on("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Benchmark host did not bind to a TCP port.");
  }
  return `http://127.0.0.1:${address.port}`;
};

const close = async (): Promise<void> => {
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolveClose();
    });
  });
};

const benchmarkEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined &&
      ![
        "ODT_ALLOWED_TOOLS",
        "ODT_FORBID_WORKSPACE_ID_INPUT",
        "ODT_HOST_TOKEN",
        "ODT_HOST_URL",
        "ODT_WORKSPACE_ID",
      ].includes(entry[0]),
  ),
);

const runStartup = async (
  entrypoint: string,
  hostUrl: string,
  workspaceId?: string,
): Promise<StartupSample> => {
  const requestStart = requests.length;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint],
    env: {
      ...benchmarkEnv,
      ODT_HOST_TOKEN: "benchmark-token",
      ODT_HOST_URL: hostUrl,
      ...(workspaceId ? { ODT_WORKSPACE_ID: workspaceId } : {}),
    },
    stderr: "inherit",
  });
  const client = new Client({ name: "openducktor-startup-benchmark", version: "1.0.0" });
  const start = performance.now();
  try {
    await client.connect(transport);
    await client.listTools();
    return {
      durationMs: performance.now() - start,
      requests: requests.slice(requestStart),
    };
  } finally {
    await client.close();
  }
};

const percentile = (values: number[], fraction: number): number => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(fraction * sorted.length) - 1] ?? Number.NaN;
};

const benchmarkMode = async (hostUrl: string, workspaceId?: string) => {
  for (let index = 0; index < 4; index += 1) {
    await runStartup(baselineEntrypoint, hostUrl, workspaceId);
    await runStartup(currentEntrypoint, hostUrl, workspaceId);
  }

  const baselineDurations: number[] = [];
  const currentDurations: number[] = [];
  let baselineRequests: RecordedRequest[] = [];
  let currentRequests: RecordedRequest[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const order: Array<readonly ["baseline" | "current", string]> =
      index % 2 === 0
        ? [
            ["baseline", baselineEntrypoint],
            ["current", currentEntrypoint],
          ]
        : [
            ["current", currentEntrypoint],
            ["baseline", baselineEntrypoint],
          ];
    for (const [name, entrypoint] of order) {
      const sample = await runStartup(entrypoint, hostUrl, workspaceId);
      if (name === "baseline") {
        baselineDurations.push(sample.durationMs);
        baselineRequests = sample.requests;
      } else {
        currentDurations.push(sample.durationMs);
        currentRequests = sample.requests;
      }
    }
  }

  const baselineP95Ms = percentile(baselineDurations, 0.95);
  const currentP95Ms = percentile(currentDurations, 0.95);
  return {
    baseline: {
      p50Ms: percentile(baselineDurations, 0.5),
      p95Ms: baselineP95Ms,
      requests: baselineRequests,
    },
    current: {
      p50Ms: percentile(currentDurations, 0.5),
      p95Ms: currentP95Ms,
      requests: currentRequests,
    },
    p95ChangeMs: currentP95Ms - baselineP95Ms,
    p95ChangePercent: ((currentP95Ms - baselineP95Ms) / baselineP95Ms) * 100,
  };
};

const hostUrl = await listen();
try {
  console.log(
    JSON.stringify(
      {
        sampleCount,
        withoutWorkspace: await benchmarkMode(hostUrl),
        withWorkspace: await benchmarkMode(hostUrl, "repo"),
      },
      null,
      2,
    ),
  );
} finally {
  await close();
}

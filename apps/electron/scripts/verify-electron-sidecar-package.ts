import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { ODT_MCP_TOOL_NAMES } from "@openducktor/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Effect } from "effect";
import { runElectronEffect } from "../src/effect/electron-boundary";
import { ElectronOperationError, errorMessage } from "../src/effect/electron-errors";
import { resolvePackagedAppResourcesDirectory } from "./electron-packaged-layout";
import type { ElectronReleaseArch, ElectronReleasePlatform } from "./electron-release-targets";
import {
  ELECTRON_SIDECAR_IDS,
  type ElectronSidecarId,
  electronSidecarDisplayName,
  electronSidecarExecutableName,
} from "./electron-sidecar-manifest";

type VerifyPackagedElectronSidecarsInput = {
  arch: ElectronReleaseArch;
  platform: ElectronReleasePlatform;
  releaseDirectory: string;
};

type PackagedSidecarErrorDetails = { readonly sidecarId: ElectronSidecarId };

export type VerifiedPackagedElectronSidecar = {
  id: ElectronSidecarId;
  path: string;
};

type PackagedSidecarInput = {
  arch: ElectronReleaseArch;
  platform: ElectronReleasePlatform;
  releaseDirectory: string;
  sidecarId: ElectronSidecarId;
};

export const resolvePackagedElectronSidecarPath = ({
  arch,
  platform,
  releaseDirectory,
  sidecarId,
}: PackagedSidecarInput): string => {
  const resourcesDirectory = resolvePackagedAppResourcesDirectory({
    arch,
    platform,
    releaseDirectory,
  });
  return join(resourcesDirectory, "bin", electronSidecarExecutableName(sidecarId, platform));
};

const assertPackagedSidecarFileEffect = ({
  path,
  platform,
  sidecarId,
}: {
  path: string;
  platform: ElectronReleasePlatform;
  sidecarId: ElectronSidecarId;
}): Effect.Effect<Stats, ElectronOperationError<PackagedSidecarErrorDetails>> =>
  Effect.tryPromise({
    try: async () => {
      const metadata = await stat(path);
      if (!metadata.isFile()) {
        throw new Error("expected a file but found a non-file entry");
      }
      if (metadata.size === 0) {
        throw new Error("expected a non-empty file");
      }
      return metadata;
    },
    catch: (cause) =>
      new ElectronOperationError({
        operation: "electron.sidecar.verify-packaged",
        message: `Invalid packaged Electron ${electronSidecarDisplayName(
          sidecarId,
        )} sidecar payload for ${platform}: ${errorMessage(cause)}. Expected path: ${path}`,
        path,
        platform,
        cause,
        details: { sidecarId },
      }),
  });

export const verifyPackagedElectronSidecarsEffect = ({
  arch,
  platform,
  releaseDirectory,
}: VerifyPackagedElectronSidecarsInput): Effect.Effect<
  VerifiedPackagedElectronSidecar[],
  ElectronOperationError<PackagedSidecarErrorDetails>
> =>
  Effect.gen(function* () {
    const verifiedSidecars: VerifiedPackagedElectronSidecar[] = [];
    for (const sidecarId of ELECTRON_SIDECAR_IDS) {
      const sidecarPath = resolvePackagedElectronSidecarPath({
        arch,
        platform,
        releaseDirectory,
        sidecarId,
      });
      const metadata = yield* assertPackagedSidecarFileEffect({
        path: sidecarPath,
        platform,
        sidecarId,
      });

      if (platform !== "windows" && process.platform !== "win32" && (metadata.mode & 0o111) === 0) {
        return yield* Effect.fail(
          new ElectronOperationError({
            operation: "electron.sidecar.verify-packaged-executable",
            message: `Invalid packaged Electron ${electronSidecarDisplayName(sidecarId)} sidecar payload for ${platform}: expected an executable file. Expected path: ${sidecarPath}`,
            path: sidecarPath,
            platform,
            details: { sidecarId },
          }),
        );
      }

      verifiedSidecars.push({ id: sidecarId, path: sidecarPath });
    }

    return verifiedSidecars;
  });

export const verifyPackagedElectronSidecars = ({
  arch,
  platform,
  releaseDirectory,
}: VerifyPackagedElectronSidecarsInput): Promise<VerifiedPackagedElectronSidecar[]> =>
  runElectronEffect(
    verifyPackagedElectronSidecarsEffect({
      arch,
      platform,
      releaseDirectory,
    }),
  );

const mcpInitializationTimeoutMs = 10_000;

const probePackagedMcpInitialization = async (path: string): Promise<void> => {
  const bridge = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/invoke/odt_mcp_ready") {
      response.writeHead(404).end();
      return;
    }
    request.resume();
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ bridgeVersion: 1, toolNames: ODT_MCP_TOOL_NAMES }));
  });
  await new Promise<void>((resolve, reject) => {
    bridge.once("error", reject);
    bridge.listen(0, "127.0.0.1", () => {
      bridge.off("error", reject);
      resolve();
    });
  });

  try {
    // SAFETY: listen succeeded on a TCP loopback address, so address() returns AddressInfo.
    const address = bridge.address() as AddressInfo;
    const transport = new StdioClientTransport({
      command: path,
      env: { ODT_HOST_URL: `http://127.0.0.1:${address.port}` },
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4_096);
    });
    const client = new Client({ name: "openducktor-release-check", version: "1.0.0" });
    try {
      await client.connect(transport, { timeout: mcpInitializationTimeoutMs });
      if (client.getServerVersion()?.name !== "openducktor") {
        throw new Error("the MCP server did not identify itself as openducktor");
      }
    } catch (cause) {
      throw new Error(`${errorMessage(cause)}${stderr ? `; stderr: ${stderr.trim()}` : ""}`, {
        cause,
      });
    } finally {
      await client.close();
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      bridge.close((error) => (error ? reject(error) : resolve()));
    });
  }
};

export const verifyPackagedMcpInitializationEffect = ({
  path,
  platform,
  sidecarId,
}: {
  path: string;
  platform: ElectronReleasePlatform;
  sidecarId: ElectronSidecarId;
}): Effect.Effect<void, ElectronOperationError<PackagedSidecarErrorDetails>> =>
  Effect.tryPromise({
    try: () => probePackagedMcpInitialization(path),
    catch: (cause) =>
      new ElectronOperationError({
        operation: "electron.sidecar.verify-packaged-initialization",
        message: `Packaged Electron ${electronSidecarDisplayName(sidecarId)} sidecar could not complete MCP initialization: ${errorMessage(cause)}. Expected path: ${path}. Rebuild the package on this host.`,
        path,
        platform,
        cause,
        details: { sidecarId },
      }),
  });

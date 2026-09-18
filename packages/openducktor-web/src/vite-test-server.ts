import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { InlineConfig, ViteDevServer } from "vite";

export const withViteTestServer = async (
  options: InlineConfig,
  run: (server: ViteDevServer) => Promise<void>,
): Promise<void> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "odt-vite-test-"));
  try {
    const { createServer } = await import("vite");
    const server = await createServer({
      root: directory,
      configFile: false,
      ...options,
      server: { fs: { strict: false }, ...options.server },
      cacheDir: path.join(directory, ".vite"),
    });
    try {
      await run(server);
    } finally {
      await server.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

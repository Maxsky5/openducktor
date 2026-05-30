import type { ToolDiscoveryId } from "@openducktor/host";

export type WebProvidedToolPaths = Partial<Record<ToolDiscoveryId, string>>;

const currentBunExecutable = (): string => {
  const executable = Bun.argv[0];
  if (!executable) {
    throw new Error("OpenDucktor web requires the current Bun executable path.");
  }
  return executable;
};

export const resolveWebProvidedToolPaths = (
  bunExecutable = currentBunExecutable(),
): WebProvidedToolPaths => ({
  bun: bunExecutable,
});

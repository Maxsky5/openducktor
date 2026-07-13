import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const electronPackageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const isElectronUpdaterInput = (inputPath: string): boolean =>
  inputPath.includes("/electron-updater/") || inputPath.includes("\\electron-updater\\");

export const verifyElectronUpdaterIsDeferred = (metafile: Bun.BuildMetafile): void => {
  const outputEntries = Object.entries(metafile.outputs);
  const mainEntry = outputEntries.find(([, output]) =>
    output.entryPoint?.endsWith("src/main/main.ts"),
  );
  if (!mainEntry) {
    throw new Error("Electron main build did not emit its expected entry bundle.");
  }

  const [mainOutputPath, mainOutput] = mainEntry;
  if (Object.keys(mainOutput.inputs).some(isElectronUpdaterInput)) {
    throw new Error(
      "electron-updater was bundled into the Electron main entry and would block startup.",
    );
  }

  const updaterOutputs = outputEntries.filter(([, output]) =>
    Object.keys(output.inputs).some(isElectronUpdaterInput),
  );
  if (updaterOutputs.length === 0) {
    throw new Error("Electron main build did not emit the lazy electron-updater chunk.");
  }
  if (!mainOutput.imports.some((entry) => entry.kind === "dynamic-import")) {
    throw new Error(
      `Electron main entry ${mainOutputPath} has no dynamic import for its deferred updater chunk.`,
    );
  }
};

export const buildElectronMain = async (): Promise<void> => {
  const result = await Bun.build({
    entrypoints: [resolve(electronPackageDirectory, "src", "main", "main.ts")],
    external: ["electron"],
    metafile: true,
    naming: {
      chunk: "chunks/[name]-[hash].[ext]",
      entry: "main.[ext]",
    },
    outdir: resolve(electronPackageDirectory, "dist"),
    splitting: true,
    target: "node",
  });

  if (!result.metafile) {
    throw new Error("Electron main build did not return bundle metadata.");
  }
  verifyElectronUpdaterIsDeferred(result.metafile);
};

if (import.meta.main) {
  await buildElectronMain();
}

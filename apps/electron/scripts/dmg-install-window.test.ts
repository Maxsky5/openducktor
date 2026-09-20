import { describe, expect, it } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const electronPackageDirectory = resolve(scriptsDirectory, "..");
const pngSignature = "89504e470d0a1a0a";

const dmgContentSchema = z.object({
  type: z.string(),
  x: z.number(),
  y: z.number(),
  path: z.string().optional(),
});

const electronBuilderDmgSchema = z.object({
  background: z.string(),
  backgroundColor: z.unknown().optional(),
  icon: z.string(),
  contents: z.array(dmgContentSchema),
});

const electronBuilderConfigSchema = z.object({
  beforePack: z.string(),
  dmg: electronBuilderDmgSchema,
});

type DmgContent = z.infer<typeof dmgContentSchema>;
type ElectronBuilderDmg = z.infer<typeof electronBuilderDmgSchema>;

const readElectronBuilderConfig = async (): Promise<
  z.infer<typeof electronBuilderConfigSchema>
> => {
  const configPath = join(electronPackageDirectory, "electron-builder.yml");
  return electronBuilderConfigSchema.parse(parse(await readFile(configPath, "utf8")));
};

const readElectronBuilderDmg = async (): Promise<ElectronBuilderDmg> => {
  const config = await readElectronBuilderConfig();
  return config.dmg;
};

// SAFETY: dmg-hidden-files.cjs exports parkHiddenDmgSupportFiles as a CommonJS function.
const { parkHiddenDmgSupportFiles } = (await import(
  join(scriptsDirectory, "dmg-hidden-files.cjs")
)) as {
  parkHiddenDmgSupportFiles: (context: {
    electronPlatformName: string;
    packager: { config: { dmg?: { contents?: DmgContent[] } } };
  }) => void;
};

const parkInto = (contents: DmgContent[], electronPlatformName = "darwin"): DmgContent[] => {
  parkHiddenDmgSupportFiles({
    electronPlatformName,
    packager: { config: { dmg: { contents } } },
  });
  return contents;
};

const resolveProjectFile = (path: string): string => resolve(electronPackageDirectory, path);

const readPngSize = async (path: string): Promise<{ height: number; width: number }> => {
  const header = (await readFile(path)).subarray(0, 24);
  if (header.subarray(0, 8).toString("hex") !== pngSignature) {
    throw new Error(`Expected a PNG file at ${path}`);
  }

  return { height: header.readUInt32BE(20), width: header.readUInt32BE(16) };
};

describe("macOS DMG install window", () => {
  it("uses a custom background image instead of the electron-builder default", async () => {
    const dmg = await readElectronBuilderDmg();

    expect(dmg.background).toBe("resources/dmg-background.png");
    expect(dmg.backgroundColor).toBeUndefined();
    expect(dmg.icon).toBe("resources/icon.icns");
  });

  it("ships a retina background that matches the install window size", async () => {
    const dmg = await readElectronBuilderDmg();
    const backgroundPath = resolveProjectFile(dmg.background);
    const standard = await readPngSize(backgroundPath);
    const retina = await readPngSize(backgroundPath.replace(/\.png$/, "@2x.png"));

    expect(standard.width).toBeGreaterThan(0);
    expect(standard.height).toBeGreaterThan(0);
    expect(retina.width).toBe(standard.width * 2);
    expect(retina.height).toBe(standard.height * 2);
  });

  it("places the app and the Applications link inside the background window", async () => {
    const dmg = await readElectronBuilderDmg();
    const { height, width } = await readPngSize(resolveProjectFile(dmg.background));
    const [appEntry, applicationsEntry] = dmg.contents;

    expect(dmg.contents).toHaveLength(2);
    if (!appEntry || !applicationsEntry) {
      throw new Error("Expected an app entry and an Applications link entry in dmg.contents.");
    }

    expect(appEntry.type).toBe("file");
    expect(appEntry.path).toBeUndefined();
    expect(applicationsEntry.type).toBe("link");
    expect(applicationsEntry.path).toBe("/Applications");

    for (const entry of [appEntry, applicationsEntry]) {
      expect(entry.x).toBeGreaterThan(0);
      expect(entry.y).toBeGreaterThan(0);
      expect(entry.x).toBeLessThan(width);
      expect(entry.y).toBeLessThan(height);
    }

    expect(Math.abs(applicationsEntry.x - appEntry.x)).toBeGreaterThan(128);
  });

  it("ships the DMG volume icon file", async () => {
    const dmg = await readElectronBuilderDmg();
    const iconFile = await stat(resolveProjectFile(dmg.icon));

    expect(iconFile.isFile()).toBe(true);
  });

  it("parks hidden support files outside the background window before packing", async () => {
    const dmg = await readElectronBuilderDmg();
    const { height } = await readPngSize(resolveProjectFile(dmg.background));
    const contents = dmg.contents.map((entry) => ({ ...entry }));

    parkInto(contents);

    const parked = contents.filter((entry) => entry.type === "position");
    expect(parked.map((entry) => entry.path).sort()).toEqual([
      ".DS_Store",
      ".VolumeIcon.icns",
      ".background.tiff",
    ]);
    for (const entry of parked) {
      expect(entry.y).toBeGreaterThan(height);
    }
    expect(contents.slice(0, 2)).toEqual(dmg.contents);
  });

  it("is a no-op on non-macOS packs and when parked entries already exist", () => {
    const entries: DmgContent[] = [{ type: "file", x: 1, y: 2 }];

    parkInto(entries, "win32");
    expect(entries).toHaveLength(1);

    parkInto(entries);
    parkInto(entries);
    expect(entries).toHaveLength(4);
  });

  it("references an existing beforePack hook", async () => {
    const config = await readElectronBuilderConfig();
    const hookFile = await stat(resolveProjectFile(config.beforePack));

    expect(hookFile.isFile()).toBe(true);
  });
});

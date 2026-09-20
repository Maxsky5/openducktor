// Parks the DMG support files that Finder reveals when hidden files are visible.
// electron-builder validates dmg.contents before hooks run, so add the dmgbuild
// "position" entries here. A position entry sets an icon location and copies nothing.
const supportFileNames = [".background.tiff", ".VolumeIcon.icns", ".DS_Store"];
const parkedY = 5000;

function parkHiddenDmgSupportFiles(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const dmg = context.packager.config.dmg;
  if (dmg == null || !Array.isArray(dmg.contents)) {
    throw new Error(
      "Cannot prepare the macOS install window: set dmg.contents to an array in electron-builder.yml.",
    );
  }

  for (const [index, name] of supportFileNames.entries()) {
    if (dmg.contents.some((entry) => entry.path === name)) {
      continue;
    }
    dmg.contents.push({ x: 200 + index * 120, y: parkedY, type: "position", path: name });
  }
}

exports.parkHiddenDmgSupportFiles = parkHiddenDmgSupportFiles;
exports.default = parkHiddenDmgSupportFiles;

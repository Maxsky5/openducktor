/// <reference types="node" />

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const tauriConfigPath = "apps/desktop/src-tauri/tauri.conf.json";
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const desktopDescription = "Task-first agentic development environment";
const armArchCandidates = ["aarch64", "arm64"] as const;
const intelArchCandidates = ["x64", "x86_64", "amd64", "intel"] as const;

const macosVersionSymbols: Record<string, string> = {
  "11": "big_sur",
  "12": "monterey",
  "13": "ventura",
  "14": "sonoma",
  "15": "sequoia",
  "26": "tahoe",
};

type TauriConfig = {
  productName?: string;
  identifier?: string;
  bundle?: {
    macOS?: {
      minimumSystemVersion?: string;
    };
  };
};

export type HomebrewCaskRenderInput = {
  version: string;
  repository: string;
  productName: string;
  bundleIdentifier: string;
  minimumSystemVersion: string;
  armAssetName: string;
  armSha256: string;
  intelAssetName: string;
  intelSha256: string;
};

type CliOptions = {
  version: string;
  repository: string;
  armAssetName: string;
  armSha256: string;
  intelAssetName: string;
  intelSha256: string;
  output: string;
  workspaceRoot: string;
};

export function validateVersion(version: string): void {
  if (!semverPattern.test(version)) {
    throw new Error(`Invalid version \`${version}\`. Expected semver like 0.1.0 or 0.1.0-rc.1.`);
  }
}

function validateRepository(repository: string): void {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error(
      `Invalid repository \`${repository}\`. Expected owner/repo, for example Maxsky5/openducktor.`,
    );
  }
}

function validateSha256(value: string, name: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`Invalid ${name} SHA-256 \`${value}\`.`);
  }
}

function extractArchToken(assetName: string, candidates: readonly string[]): string {
  const normalizedAssetName = assetName.toLowerCase();
  const token = candidates.find((candidate) => normalizedAssetName.includes(candidate));

  if (!token) {
    throw new Error(`Could not resolve an architecture token from asset name \`${assetName}\`.`);
  }

  return token;
}

export function resolveAssetPattern(
  version: string,
  armAssetName: string,
  intelAssetName: string,
): { armArchToken: string; intelArchToken: string; assetPattern: string } {
  validateVersion(version);

  if (armAssetName === intelAssetName) {
    throw new Error(
      "Arm and Intel asset names must differ so the cask can select by architecture.",
    );
  }

  const armArchToken = extractArchToken(armAssetName, armArchCandidates);
  const intelArchToken = extractArchToken(intelAssetName, intelArchCandidates);

  const armPattern = armAssetName
    .replace(armArchToken, "#{arch}")
    .replaceAll(version, "#{version}");
  const intelPattern = intelAssetName
    .replace(intelArchToken, "#{arch}")
    .replaceAll(version, "#{version}");

  if (armPattern !== intelPattern) {
    throw new Error(
      `Could not derive a shared asset pattern from \`${armAssetName}\` and \`${intelAssetName}\`.`,
    );
  }

  if (armPattern === armAssetName && armAssetName.includes(version)) {
    throw new Error(
      `Could not replace version \`${version}\` inside asset pattern derived from \`${armAssetName}\`.`,
    );
  }

  return {
    armArchToken,
    intelArchToken,
    assetPattern: armPattern,
  };
}

export function resolveHomebrewMacosRequirement(minimumSystemVersion: string): string {
  const majorVersion = minimumSystemVersion.trim().split(".")[0];
  const symbol = majorVersion ? macosVersionSymbols[majorVersion] : undefined;

  if (!symbol) {
    throw new Error(
      `Unsupported macOS minimum system version \`${minimumSystemVersion}\`. Add a Homebrew symbol mapping before releasing.`,
    );
  }

  return `>= :${symbol}`;
}

export function readDesktopReleaseMetadata(workspaceRoot = process.cwd()): {
  productName: string;
  bundleIdentifier: string;
  minimumSystemVersion: string;
} {
  const absolutePath = resolve(workspaceRoot, tauriConfigPath);
  const parsed = JSON.parse(readFileSync(absolutePath, "utf8")) as TauriConfig;
  const productName = parsed.productName?.trim();
  const bundleIdentifier = parsed.identifier?.trim();
  const minimumSystemVersion = parsed.bundle?.macOS?.minimumSystemVersion?.trim();

  if (!productName) {
    throw new Error(`Missing productName in ${tauriConfigPath}`);
  }

  if (!bundleIdentifier) {
    throw new Error(`Missing identifier in ${tauriConfigPath}`);
  }

  if (!minimumSystemVersion) {
    throw new Error(`Missing bundle.macOS.minimumSystemVersion in ${tauriConfigPath}`);
  }

  return {
    productName,
    bundleIdentifier,
    minimumSystemVersion,
  };
}

function rubyStringLiteral(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function renderHomebrewCask(input: HomebrewCaskRenderInput): string {
  validateVersion(input.version);
  validateRepository(input.repository);
  validateSha256(input.armSha256, "arm");
  validateSha256(input.intelSha256, "intel");

  const { armArchToken, intelArchToken, assetPattern } = resolveAssetPattern(
    input.version,
    input.armAssetName,
    input.intelAssetName,
  );
  const minimumMacosRequirement = resolveHomebrewMacosRequirement(input.minimumSystemVersion);
  const homepage = `https://github.com/${input.repository}`;
  const downloadUrl = `${homepage}/releases/download/v#{version}/${assetPattern}`;

  return [
    'cask "openducktor" do',
    `  arch arm: "${rubyStringLiteral(armArchToken)}", intel: "${rubyStringLiteral(intelArchToken)}"`,
    "",
    `  version "${rubyStringLiteral(input.version)}"`,
    `  sha256 arm:   "${rubyStringLiteral(input.armSha256.toLowerCase())}",`,
    `         intel: "${rubyStringLiteral(input.intelSha256.toLowerCase())}"`,
    "",
    `  url "${rubyStringLiteral(downloadUrl)}"`,
    `  name "${rubyStringLiteral(input.productName)}"`,
    `  desc "${rubyStringLiteral(desktopDescription)}"`,
    `  homepage "${rubyStringLiteral(homepage)}"`,
    "",
    "  livecheck do",
    "    url :url",
    "    strategy :github_latest",
    "  end",
    "",
    `  depends_on macos: "${rubyStringLiteral(minimumMacosRequirement)}"`,
    "",
    `  app "${rubyStringLiteral(`${input.productName}.app`)}"`,
    "",
    "  zap trash: [",
    '    "~/.openducktor",',
    `    "~/Library/Preferences/${rubyStringLiteral(input.bundleIdentifier)}.plist",`,
    `    "~/Library/Saved Application State/${rubyStringLiteral(input.bundleIdentifier)}.savedState",`,
    "  ]",
    "end",
    "",
  ].join("\n");
}

function usage(): never {
  console.error(
    "Usage: bun run scripts/release-homebrew-cask.ts --version <version> --repository <owner/repo> --arm-asset-name <name> --arm-sha256 <sha256> --intel-asset-name <name> --intel-sha256 <sha256> --output <path> [--workspace-root <path>]",
  );
  process.exit(1);
}

function parseCliOptions(argv: string[]): CliOptions {
  const options = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];

    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      usage();
    }

    options.set(flag, value);
  }

  const version = options.get("--version");
  const repository = options.get("--repository");
  const armAssetName = options.get("--arm-asset-name");
  const armSha256 = options.get("--arm-sha256");
  const intelAssetName = options.get("--intel-asset-name");
  const intelSha256 = options.get("--intel-sha256");
  const output = options.get("--output");

  if (
    !version ||
    !repository ||
    !armAssetName ||
    !armSha256 ||
    !intelAssetName ||
    !intelSha256 ||
    !output
  ) {
    usage();
  }

  return {
    version,
    repository,
    armAssetName,
    armSha256,
    intelAssetName,
    intelSha256,
    output,
    workspaceRoot: options.get("--workspace-root") ?? process.cwd(),
  };
}

export function runCli(argv = process.argv.slice(2)): void {
  const options = parseCliOptions(argv);
  const desktopMetadata = readDesktopReleaseMetadata(options.workspaceRoot);
  const outputPath = resolve(options.workspaceRoot, options.output);
  const caskContents = renderHomebrewCask({
    version: options.version,
    repository: options.repository,
    productName: desktopMetadata.productName,
    bundleIdentifier: desktopMetadata.bundleIdentifier,
    minimumSystemVersion: desktopMetadata.minimumSystemVersion,
    armAssetName: options.armAssetName,
    armSha256: options.armSha256,
    intelAssetName: options.intelAssetName,
    intelSha256: options.intelSha256,
  });

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, caskContents);
}

if (import.meta.main) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

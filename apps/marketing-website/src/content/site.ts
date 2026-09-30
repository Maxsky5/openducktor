import webRunner from "../../../../packages/openducktor-web/package.json" with { type: "json" };

/** The GitHub repository of OpenDucktor, as `owner/name`. */
export const REPOSITORY = "Maxsky5/openducktor";
const github = `https://github.com/${REPOSITORY}`;

export const links = {
  github,
  latest: `${github}/releases/latest`,
  releases: `${github}/releases`,
  issues: `${github}/issues`,
  license: `${github}/blob/main/LICENSE`,
  installation: `${github}/blob/main/docs/installation.md`,
  webRunner: `${github}/blob/main/docs/web-runner.md`,
  mcp: `${github}/blob/main/docs/external-mcp.md`,
} as const;
/** The claim of the site. The opening heading shows it on two lines. */
export const claim = ["Open-source mission control", "for coding agents"] as const;
export const tagline = claim.join(" ");
export const title = `OpenDucktor | ${tagline}`;
export const description = `${tagline}. OpenDucktor orchestrates OpenCode, Codex, and Claude Code, from the spec to the pull request, on your computer.`;
const scripts = `https://raw.githubusercontent.com/${REPOSITORY}/main`;
export const commands = {
  unix: `curl -fsSL ${scripts}/install.sh | sh`,
  windows: `irm ${scripts}/install.ps1 | iex`,
  brew: `brew install --cask ${REPOSITORY}/openducktor`,
  browser: `npx ${webRunner.name}`,
} as const;

/**
 * The terminal installs of the desktop app. The install section shows each one in a terminal with
 * the id install-{id}, and the opening links to these terminals.
 */
export const desktopInstalls = [
  {
    id: "unix",
    title: "macOS and Linux",
    prompt: "~ %",
    command: commands.unix,
    note: "For macOS on Apple silicon or Intel, and for Linux x64.",
  },
  {
    id: "windows",
    title: "Windows",
    prompt: "PS C:\\Users\\you>",
    command: commands.windows,
    note: "For Windows x64, in Windows PowerShell 5.1 or PowerShell 7.",
  },
  {
    id: "brew",
    title: "Homebrew",
    prompt: "~ %",
    command: commands.brew,
    note: "Installs the signed and notarized macOS app from GitHub Releases.",
  },
] as const;

/** The oldest Node.js version that runs the browser version, from the engines of its package. */
export const nodeVersion = minimumVersion(webRunner.engines.node);

function minimumVersion(range: string): string {
  const version = /^>=(\d+\.\d+)\.0$/.exec(range)?.[1];
  if (!version) {
    throw new Error(`Update the Node.js requirement of the site for the engine range "${range}".`);
  }
  return version;
}

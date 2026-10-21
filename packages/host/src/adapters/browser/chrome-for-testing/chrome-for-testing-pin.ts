/**
 * The Chrome for Testing version that the web runner downloads.
 *
 * Release process: pick the Stable version from
 * https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json,
 * download the full `chrome` archive of each platform below once, and write its byte size and
 * SHA-256 here (the JSON has no checksum). Copy `chrome-linux64/deb.deps` into
 * `CHROME_FOR_TESTING_DEBIAN_PACKAGES`. A new version makes each host download the browser again.
 */
export const CHROME_FOR_TESTING_VERSION = "155.0.8059.39";

export type ChromeForTestingPlatform = "linux64" | "mac-arm64" | "mac-x64" | "win64";

export type ChromeForTestingArchive = {
  readonly platform: ChromeForTestingPlatform;
  readonly url: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  /** The browser executable, relative to the folder that the archive extracts into. */
  readonly executable: readonly string[];
};

const archiveUrl = (platform: ChromeForTestingPlatform): string =>
  `https://storage.googleapis.com/chrome-for-testing-public/${CHROME_FOR_TESTING_VERSION}/${platform}/chrome-${platform}.zip`;

const macExecutable = (platform: "mac-arm64" | "mac-x64"): readonly string[] => [
  `chrome-${platform}`,
  "Google Chrome for Testing.app",
  "Contents",
  "MacOS",
  "Google Chrome for Testing",
];

export const CHROME_FOR_TESTING_ARCHIVES = [
  {
    platform: "linux64",
    url: archiveUrl("linux64"),
    sizeBytes: 198_195_769,
    sha256: "55672d1f392fd3e7b7a08621b6e804e6bcb39d40cf155504abb74b3a021ea8ea",
    executable: ["chrome-linux64", "chrome"],
  },
  {
    platform: "mac-arm64",
    url: archiveUrl("mac-arm64"),
    sizeBytes: 192_634_606,
    sha256: "529a71bd61aaa2ef266a4d4bd300ae9572ba6a3468a8d55c3023ffeffb5b6b4e",
    executable: macExecutable("mac-arm64"),
  },
  {
    platform: "mac-x64",
    url: archiveUrl("mac-x64"),
    sizeBytes: 203_101_743,
    sha256: "9e4da7961d4a426078f02e89ecfa569a7926ada2dc88aa53c0bd9ed0d46c3bb7",
    executable: macExecutable("mac-x64"),
  },
  {
    platform: "win64",
    url: archiveUrl("win64"),
    sizeBytes: 207_197_429,
    sha256: "59ab2a6e99bde9c0bc180414988394f9f5355a0d3764c704151ee8ecea235c7e",
    executable: ["chrome-win64", "chrome.exe"],
  },
] as const satisfies readonly ChromeForTestingArchive[];

export const CHROME_FOR_TESTING_SUPPORTED_PLATFORMS: readonly ChromeForTestingPlatform[] =
  CHROME_FOR_TESTING_ARCHIVES.map((archive) => archive.platform);

/** The Debian and Ubuntu packages from `chrome-linux64/deb.deps` of the pinned version. */
export const CHROME_FOR_TESTING_DEBIAN_PACKAGES: readonly string[] = [
  "ca-certificates",
  "fonts-liberation",
  "libasound2",
  "libatk-bridge2.0-0",
  "libatk1.0-0",
  "libatspi2.0-0",
  "libc6",
  "libcairo2",
  "libcups2",
  "libcurl4",
  "libdbus-1-3",
  "libexpat1",
  "libgbm1",
  "libglib2.0-0",
  "libgtk-3-0",
  "libnspr4",
  "libnss3",
  "libpango-1.0-0",
  "libudev1",
  "libvulkan1",
  "libx11-6",
  "libxcb1",
  "libxcomposite1",
  "libxdamage1",
  "libxext6",
  "libxfixes3",
  "libxkbcommon0",
  "libxrandr2",
  "wget",
  "xdg-utils",
];

/** Selects the pinned archive for a Node `process.platform` and `process.arch` pair. */
export const selectChromeForTestingArchive = (
  platform: string,
  arch: string,
): ChromeForTestingArchive | null => {
  const name =
    platform === "linux" && arch === "x64"
      ? "linux64"
      : platform === "darwin" && arch === "arm64"
        ? "mac-arm64"
        : platform === "darwin" && arch === "x64"
          ? "mac-x64"
          : platform === "win32" && arch === "x64"
            ? "win64"
            : null;
  return CHROME_FOR_TESTING_ARCHIVES.find((archive) => archive.platform === name) ?? null;
};

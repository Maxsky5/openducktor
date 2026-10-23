import type { ArtifactPreviewEnvironment } from "@openducktor/contracts";

type BrowserEngine = Pick<Navigator, "userAgent"> & {
  userAgentData?: { brands: readonly { brand: string; version: string }[] };
};

export const chromiumArtifactPreviewSupport = (
  chromiumVersion: string | undefined,
): ArtifactPreviewEnvironment["scriptedHtml"] => {
  const major =
    chromiumVersion && /^\d+(?:\.\d+)*$/.test(chromiumVersion)
      ? Number(chromiumVersion.split(".")[0])
      : 0;
  return major >= 152
    ? { supported: true }
    : {
        supported: false,
        reason:
          "HTML preview isolation needs Chromium 152 or later. Download this artifact to open it outside OpenDucktor.",
      };
};

/** Check the client engine, including when the selected host runs Electron. */
export const browserArtifactPreviewEnvironment = (
  endpoint: string,
  engine: BrowserEngine = navigator,
): ArtifactPreviewEnvironment => {
  const brands = engine.userAgentData?.brands;
  const version = brands
    ? brands.find(({ brand }) => brand === "Chromium")?.version
    : /\b(?:Chrome|Chromium)\/(\d+(?:\.\d+)*)/.exec(engine.userAgent)?.[1];
  const ios = /\b(?:iPhone|iPad|iPod)\b/.test(engine.userAgent);
  const base = new URL(endpoint);
  base.pathname = `${base.pathname.replace(/\/$/, "")}/artifact-preview-bootstrap`;
  base.search = "";
  base.hash = "";
  return {
    bootstrapUrl: base.href,
    scriptedHtml: chromiumArtifactPreviewSupport(ios ? undefined : version),
  };
};

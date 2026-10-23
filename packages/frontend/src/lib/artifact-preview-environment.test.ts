import { expect, test } from "bun:test";
import {
  browserArtifactPreviewEnvironment,
  chromiumArtifactPreviewSupport,
} from "./artifact-preview-environment";

test("scripted preview admission requires a recognized Chromium version with Connection Allowlist support", () => {
  for (const version of [undefined, "", "151.9", "152foo"]) {
    expect(chromiumArtifactPreviewSupport(version).supported).toBe(false);
  }
  expect(chromiumArtifactPreviewSupport("152.0.7977.167").supported).toBe(true);
  expect(chromiumArtifactPreviewSupport("155").supported).toBe(true);
  const endpoint = "https://host.test/proxy/remote/?ignored=secret#fragment";
  const recognized = browserArtifactPreviewEnvironment(endpoint, {
    userAgent: "Chrome/152.0.0.0",
    userAgentData: { brands: [{ brand: "Chromium", version: "152" }] },
  });
  expect(recognized).toEqual({
    bootstrapUrl: "https://host.test/proxy/remote/artifact-preview-bootstrap",
    scriptedHtml: { supported: true },
  });
  for (const userAgent of [
    "Firefox/160.0",
    "Version/26.0 Safari/605.1.15",
    "iPhone Chrome/152.0.0.0",
  ]) {
    expect(browserArtifactPreviewEnvironment(endpoint, { userAgent }).scriptedHtml.supported).toBe(
      false,
    );
  }
});

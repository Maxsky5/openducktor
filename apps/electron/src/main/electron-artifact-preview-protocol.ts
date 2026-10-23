import type { Session } from "electron";
import { artifactPreviewBootstrapResponse } from "@openducktor/remote-host/artifact-preview-bootstrap";
import {
  ELECTRON_ARTIFACT_PREVIEW_URL,
  ELECTRON_ARTIFACT_PREVIEW_PROTOCOL,
} from "../shared/electron-bridge-contract";

export const registerElectronArtifactPreviewProtocol = (session: Session): void => {
  session.protocol.handle(ELECTRON_ARTIFACT_PREVIEW_PROTOCOL, (request) => {
    if (request.method !== "GET" || request.url !== ELECTRON_ARTIFACT_PREVIEW_URL) {
      return new Response("Artifact preview route not found.", { status: 404 });
    }
    return artifactPreviewBootstrapResponse();
  });
};

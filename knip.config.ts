import electronKnipConfig from "./apps/electron/knip.config";
import frontendKnipConfig from "./packages/frontend/knip.config";
import webKnipConfig from "./packages/openducktor-web/knip.config";

export default {
  tags: ["-internal"],
  workspaces: {
    "apps/electron": electronKnipConfig,
    "packages/frontend": frontendKnipConfig,
    "packages/openducktor-web": webKnipConfig,
  },
};

export default {
  entry: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
  project: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
  ignoreDependencies: [
    "@anthropic-ai/claude-agent-sdk",
    "undici",
    "@ff-labs/fff-node",
    // The host bundle externalizes MSAL's native persistence package.
    "@azure/msal-node-extensions",
  ],
};

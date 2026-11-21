export default {
  entry: [
    "src/{cli,*-worker}.ts",
    "src/**/*.test.{ts,tsx}",
    "src/**/*-fixture.{ts,tsx}",
    "scripts/*.ts",
  ],
  project: ["src/**/*.{ts,tsx,css}", "scripts/**/*.ts"],
  ignoreDependencies: [
    "@ff-labs/fff-node",
    // The host bundle externalizes MSAL's native persistence package.
    "@azure/msal-node-extensions",
    // The host bundle externalizes the native terminal package.
    "node-pty",
    // The host bundle externalizes the browser automation package.
    "playwright-core",
  ],
};

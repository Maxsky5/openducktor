import { createRequire } from "node:module";

const frontendRequire = createRequire(
  new URL("../packages/frontend/package.json", import.meta.url),
);
const { GlobalRegistrator } = await import(
  frontendRequire.resolve("@happy-dom/global-registrator")
);

if (typeof document === "undefined") {
  GlobalRegistrator.register();
}

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { afterEach } = await import("bun:test");
const { cleanup } = await import(frontendRequire.resolve("@testing-library/react"));

afterEach((): void => {
  cleanup();
});

import { hasRuntimeType } from "@openducktor/contracts";
import { createRequire } from "node:module";

const frontendRequire = createRequire(
  new URL("../packages/frontend/package.json", import.meta.url),
);
const { GlobalRegistrator } = await import(
  frontendRequire.resolve("@happy-dom/global-registrator")
);

if (hasRuntimeType(globalThis.document, "undefined")) {
  GlobalRegistrator.register();
}

// SAFETY: This test controls the fixture and supplies `typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }` used by this case.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { afterEach } = await import("bun:test");
const { cleanup } = await import(frontendRequire.resolve("@testing-library/react"));

afterEach((): void => {
  cleanup();
});

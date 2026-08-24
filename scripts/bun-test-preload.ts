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

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

const { afterEach } = await import("bun:test");
const { cleanup } = await import(frontendRequire.resolve("@testing-library/react"));

afterEach((): void => {
  cleanup();
});

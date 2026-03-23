import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (typeof document === "undefined") {
  GlobalRegistrator.register();
}

const { afterEach } = await import("bun:test");
const { cleanup } = await import("@testing-library/react");

afterEach((): void => {
  cleanup();
});

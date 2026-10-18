// Import this module first in a test file that renders React. Package tests run without DOM globals.
import { afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { enableReactActEnvironment } from "./react-act-environment";

if (globalThis.document === undefined) {
  GlobalRegistrator.register();
}
enableReactActEnvironment();
const { cleanup } = await import("@testing-library/react");
afterEach(() => {
  cleanup();
});

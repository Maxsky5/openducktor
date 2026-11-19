// The tests of this package share one process. GSAP binds the browser window when it loads, or at
// its first tick, and it keeps that window. A test that needs no window can load GSAP first, and
// GSAP then has no window for the tests that register happy-dom later. This preload loads GSAP
// with a window, as a browser does. happy-dom makes `window` the global object, so each later
// registration reaches GSAP.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
await import("gsap");
await GlobalRegistrator.unregister();

const REACT_TEST_RENDERER_DEPRECATION = "react-test-renderer is deprecated";
const ORCHESTRATOR_WARN_PREFIX = "[agent-orchestrator]";

const isReactTestRendererDeprecation = (value: unknown): boolean =>
  typeof value === "string" && value.includes(REACT_TEST_RENDERER_DEPRECATION);

const isExpectedOrchestratorWarning = (args: unknown[]): boolean => {
  const [firstArg] = args;
  if (typeof firstArg !== "string" || !firstArg.startsWith(ORCHESTRATOR_WARN_PREFIX)) {
    return false;
  }
  return true;
};

const shouldSuppressConsoleMessage = (args: unknown[]): boolean => {
  const [firstArg] = args;
  return isReactTestRendererDeprecation(firstArg) || isExpectedOrchestratorWarning(args);
};

const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleLog = console.log;
const originalConsoleInfo = console.info;

console.error = (...args: Parameters<typeof console.error>): void => {
  if (shouldSuppressConsoleMessage(args)) {
    return;
  }
  originalConsoleError(...args);
};

console.warn = (...args: Parameters<typeof console.warn>): void => {
  if (shouldSuppressConsoleMessage(args)) {
    return;
  }
  originalConsoleWarn(...args);
};

console.log = (...args: Parameters<typeof console.log>): void => {
  if (shouldSuppressConsoleMessage(args)) {
    return;
  }
  originalConsoleLog(...args);
};

console.info = (...args: Parameters<typeof console.info>): void => {
  if (shouldSuppressConsoleMessage(args)) {
    return;
  }
  originalConsoleInfo(...args);
};

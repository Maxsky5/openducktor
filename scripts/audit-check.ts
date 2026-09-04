import { checkHighSeverityAdvisories } from "./audit-high-severity-guard";
import { checkHonoAdvisories } from "./audit-hono-guard";
import {
  runBunAuditCli,
  runBunAuditJson,
  type AuditReporter,
  type BunAuditJsonResult,
} from "./audit-utils";

type ReadAudit = () => BunAuditJsonResult;

export const runDependencyAuditChecks = (
  readAudit: ReadAudit = () => runBunAuditJson("[deps:audit]"),
  reporter: AuditReporter = console,
): number => {
  const { parsed, exitCode } = readAudit();
  const highSeverityExitCode = checkHighSeverityAdvisories(parsed, reporter);
  if (highSeverityExitCode !== 0) {
    return highSeverityExitCode;
  }
  return checkHonoAdvisories(parsed, exitCode, reporter);
};

if (import.meta.main) {
  runBunAuditCli(() => runDependencyAuditChecks());
}

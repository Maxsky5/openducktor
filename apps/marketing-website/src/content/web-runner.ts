// The start log that the web runner prints: launcher.ts and logger.ts in packages/openducktor-web.
// The times and the ports are an example.

type Part = { text: string; tone: string };
type LogLine = { wait: number; stamp: string; message: Part[] };

function part(text: string, tone = ""): Part {
  return { text, tone };
}

/**
 * One line of the web runner log. `wait` is the time in seconds between the line before and
 * this line. The message keeps its colors, and it goes under the time when the line is long.
 */
function logLine(wait: number, stamp: string, ...message: Part[]): LogLine {
  return { wait, stamp, message: [part("INFO ", "t-level"), ...message] };
}

function localUrl(url: string): Part[] {
  return [
    part("  "),
    part("➜", "t-arrow"),
    part("  "),
    part("Local:", "t-label"),
    part("   "),
    part(url, "t-link"),
  ];
}

/** The start log of the web runner. The host takes a moment to get ready. */
export const START_LOG: LogLine[] = [
  logLine(0, "2026-09-27T10:14:02.318+02:00", part("Starting OpenDucktor frontend server...")),
  logLine(0.3, "2026-09-27T10:14:02.341+02:00", part("Starting OpenDucktor TypeScript host...")),
  logLine(
    0.5,
    "2026-09-27T10:14:02.906+02:00",
    part("Waiting for OpenDucktor TypeScript host readiness..."),
  ),
  logLine(1.2, "2026-09-27T10:14:04.117+02:00", part("OpenDucktor web is ready:", "t-ready")),
  logLine(0.15, "2026-09-27T10:14:04.118+02:00", ...localUrl("http://localhost:1420/")),
  logLine(0.15, "2026-09-27T10:14:04.118+02:00", ...localUrl("http://127.0.0.1:1420/")),
  logLine(
    0.15,
    "2026-09-27T10:14:04.119+02:00",
    part("  ➜  Backend: http://127.0.0.1:14327", "t-success"),
  ),
];

import { createOpenDucktorDailyLogWriter, type OpenDucktorDailyLogWriter } from "@openducktor/host";
import { Effect } from "effect";
import { errorMessage, WebResourceError } from "./effect/web-errors";

type LogLevel = "INFO" | "ERROR";

type WebLogConsole = {
  error(message: string): void;
  log(message: string): void;
};

type WebLogOutputStream = {
  isTTY?: boolean;
};

type WebLoggerInput = {
  console?: WebLogConsole;
  environment?: NodeJS.ProcessEnv;
  now?: () => Date;
  stdout?: WebLogOutputStream;
  writer?: OpenDucktorDailyLogWriter;
};

export type WebLogger = {
  error(message: string): Effect.Effect<void, unknown>;
  info(message: string): Effect.Effect<void, unknown>;
  success(message: string): Effect.Effect<void, unknown>;
};

export const writeWebLogEffect = (
  logger: WebLogger,
  level: keyof WebLogger,
  message: string,
): Effect.Effect<void, WebResourceError> =>
  logger[level](message).pipe(
    Effect.mapError(
      (cause) =>
        new WebResourceError({
          resource: "persistent-log",
          operation: `web.log-${level}`,
          message: errorMessage(cause),
          cause,
        }),
    ),
  );

const RESET = "\u001b[0m";
const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const BLUE = "\u001b[34m";
const CYAN = "\u001b[36m";
const MAGENTA = "\u001b[35m";
const GREEN = "\u001b[32m";
const RED = "\u001b[31m";

const forceColorEnabled = (environment: NodeJS.ProcessEnv): boolean => {
  const value = environment.FORCE_COLOR?.trim();
  return value !== undefined && value !== "" && value !== "0";
};

const supportsColor = (environment: NodeJS.ProcessEnv, stdout: WebLogOutputStream): boolean => {
  if (environment.NO_COLOR !== undefined) {
    return false;
  }
  return forceColorEnabled(environment) || stdout.isTTY === true;
};

const pad = (value: number, length = 2): string => String(value).padStart(length, "0");

const timezoneOffset = (date: Date): string => {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(absoluteMinutes / 60))}:${pad(absoluteMinutes % 60)}`;
};

const timestamp = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
    date.getMilliseconds(),
    3,
  )}${timezoneOffset(date)}`;

const colorLevel = (useColor: boolean, level: LogLevel): string => {
  if (!useColor) {
    return level;
  }
  return `${level === "INFO" ? BLUE : RED}${level}${RESET}`;
};

const colorMessage = (useColor: boolean, message: string, color: string | null): string => {
  if (!useColor || !color) {
    return message;
  }
  return `${color}${message}${RESET}`;
};

const colorSuccessMessage = (useColor: boolean, message: string): string => {
  if (!useColor) {
    return message;
  }

  const availabilityLine = message.match(/^(\s*)(➜)(\s+)(Local:)(\s+)(https?:\/\/\S+)$/);
  if (availabilityLine) {
    const [, indent, arrow, arrowGap, label, labelGap, url] = availabilityLine;
    return `${indent}${BOLD}${MAGENTA}${arrow}${RESET}${arrowGap}${BLUE}${label}${RESET}${labelGap}${BOLD}${CYAN}${url}${RESET}`;
  }

  if (message.endsWith(":")) {
    return `${BOLD}${GREEN}${message}${RESET}`;
  }

  return `${GREEN}${message}${RESET}`;
};

export const createWebLogger = ({
  console: consoleOutput = console,
  environment = process.env,
  now = () => new Date(),
  stdout = process.stdout,
  writer,
}: WebLoggerInput = {}) =>
  (writer
    ? Effect.succeed(writer)
    : createOpenDucktorDailyLogWriter({ surface: "web", environment, clock: now })
  ).pipe(
    Effect.map((resolvedWriter): WebLogger => {
      const writeLog = (
        level: LogLevel,
        message: string,
        renderMessage: (useColor: boolean, message: string) => string,
      ): Effect.Effect<void, unknown> =>
        Effect.gen(function* () {
          const recordedAt = now();
          const useColor = supportsColor(environment, stdout);
          const plainTimestamp = timestamp(recordedAt);
          const renderedTimestamp = useColor ? `${DIM}${plainTimestamp}${RESET}` : plainTimestamp;
          const line = `${renderedTimestamp}  ${colorLevel(useColor, level)} ${renderMessage(
            useColor,
            message,
          )}`;
          if (level === "ERROR") {
            consoleOutput.error(line);
          } else {
            consoleOutput.log(line);
          }
          yield* resolvedWriter.append(recordedAt, `${plainTimestamp}  ${level} ${message}`);
        });

      return {
        error(message) {
          return writeLog("ERROR", message, (useColor, value) =>
            colorMessage(useColor, value, RED),
          );
        },
        info(message) {
          return writeLog("INFO", message, (useColor, value) =>
            colorMessage(useColor, value, null),
          );
        },
        success(message) {
          return writeLog("INFO", message, colorSuccessMessage);
        },
      };
    }),
  );

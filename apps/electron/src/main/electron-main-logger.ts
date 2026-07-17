const ANSI_RESET = "\u001b[0m";
const ANSI_DIM = "\u001b[2m";
const ANSI_BLUE = "\u001b[34m";
const ANSI_GREEN = "\u001b[32m";
const ANSI_ORANGE = "\u001b[33m";
const ANSI_RED = "\u001b[31m";

type LogLevel = "INFO" | "WARN" | "ERROR";

type LogStream = {
  isTTY?: boolean;
  write(chunk: string): unknown;
};

type ElectronMainLoggerInput = {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  stream?: LogStream;
  writer?: OpenDucktorDailyLogWriter;
};

export type ElectronMainLogger = {
  error(message: string, error?: unknown): void;
  info(message: string): void;
  warn(message: string): void;
};

const pad = (value: number, length = 2): string => value.toString().padStart(length, "0");

const timestamp = (date: Date): string => {
  const offsetMinutes = -date.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffsetMinutes = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absoluteOffsetMinutes / 60);
  const offsetRemainderMinutes = absoluteOffsetMinutes % 60;

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
    date.getMilliseconds(),
    3,
  )}${offsetSign}${pad(offsetHours)}:${pad(offsetRemainderMinutes)}`;
};

const shouldUseAnsi = (env: NodeJS.ProcessEnv, stream: LogStream): boolean => {
  if (env.NO_COLOR !== undefined) {
    return false;
  }

  const forceColor = env.FORCE_COLOR?.trim();
  if (forceColor && forceColor !== "0") {
    return true;
  }

  return stream.isTTY === true;
};

const colorize = (useAnsi: boolean, color: string, value: string): string =>
  useAnsi ? `${color}${value}${ANSI_RESET}` : value;

const colorForLevel = (level: LogLevel): string => {
  if (level === "ERROR") {
    return ANSI_RED;
  }
  if (level === "WARN") {
    return ANSI_ORANGE;
  }
  return ANSI_BLUE;
};

const isSuccessLogMessage = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes(" is ready") ||
    normalized.includes(" is listening") ||
    normalized.includes(" stopped") ||
    normalized.includes("shutdown complete") ||
    normalized.includes("web is ready")
  );
};

const colorMessage = (useAnsi: boolean, level: LogLevel, message: string): string => {
  if (!useAnsi) {
    return message;
  }

  if (level === "ERROR") {
    return colorize(true, ANSI_RED, message);
  }
  if (level === "WARN") {
    return colorize(true, ANSI_ORANGE, message);
  }
  if (isSuccessLogMessage(message)) {
    return colorize(true, ANSI_GREEN, message);
  }
  return message;
};

const formatError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
};

export const createElectronMainLogger = ({
  env = process.env,
  now = () => new Date(),
  stream = process.stderr,
  writer = createOpenDucktorDailyLogWriter({ surface: "electron", environment: env, clock: now }),
}: ElectronMainLoggerInput = {}): ElectronMainLogger => {
  const log = (level: LogLevel, message: string): void => {
    const recordedAt = now();
    const useAnsi = shouldUseAnsi(env, stream);
    const plainTimestamp = timestamp(recordedAt);
    const renderedTimestamp = colorize(useAnsi, ANSI_DIM, plainTimestamp);
    const renderedLevel = colorize(useAnsi, colorForLevel(level), level);
    const renderedMessage = colorMessage(useAnsi, level, message);
    stream.write(`${renderedTimestamp}  ${renderedLevel} ${renderedMessage}\n`);
    writer.append(recordedAt, `${plainTimestamp}  ${level} ${message}`);
  };

  return {
    error(message, error) {
      log("ERROR", error === undefined ? message : `${message}: ${formatError(error)}`);
    },
    info(message) {
      log("INFO", message);
    },
    warn(message) {
      log("WARN", message);
    },
  };
};

import { createOpenDucktorDailyLogWriter, type OpenDucktorDailyLogWriter } from "@openducktor/host";

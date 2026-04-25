type LogLevel = "INFO" | "WARN" | "ERROR";

const RESET = "\u001b[0m";
const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const BLUE = "\u001b[34m";
const CYAN = "\u001b[36m";
const ORANGE = "\u001b[33m";
const MAGENTA = "\u001b[35m";
const GREEN = "\u001b[32m";
const RED = "\u001b[31m";

const forceColorEnabled = (): boolean => {
  const value = process.env.FORCE_COLOR?.trim();
  return value !== undefined && value !== "" && value !== "0";
};

const supportsColor = (): boolean => {
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }
  return forceColorEnabled() || Boolean(process.stdout.isTTY);
};

const pad = (value: number, length = 2): string => String(value).padStart(length, "0");

const timezoneOffset = (date: Date): string => {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(absoluteMinutes / 60))}:${pad(absoluteMinutes % 60)}`;
};

const timestamp = (): string => {
  const date = new Date();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
    date.getMilliseconds(),
    3,
  )}${timezoneOffset(date)}`;
};

const levelColor = (level: LogLevel): string => {
  if (level === "INFO") {
    return BLUE;
  }
  if (level === "WARN") {
    return ORANGE;
  }
  return RED;
};

const colorLevel = (level: LogLevel): string => {
  if (!supportsColor()) {
    return level;
  }
  return `${levelColor(level)}${level}${RESET}`;
};

const colorMessage = (message: string, color: string | null): string => {
  if (!supportsColor() || !color) {
    return message;
  }
  return `${color}${message}${RESET}`;
};

const colorSuccessMessage = (message: string): string => {
  if (!supportsColor()) {
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

const writeLog = (level: LogLevel, message: string, messageColor: string | null = null): void => {
  const line = `${supportsColor() ? `${DIM}${timestamp()}${RESET}` : timestamp()}  ${colorLevel(
    level,
  )} ${colorMessage(message, messageColor)}`;
  if (level === "ERROR") {
    console.error(line);
    return;
  }
  console.log(line);
};

export const logInfo = (message: string): void => writeLog("INFO", message);
export const logSuccess = (message: string): void => {
  if (!supportsColor()) {
    writeLog("INFO", message);
    return;
  }

  const line = `${DIM}${timestamp()}${RESET}  ${colorLevel("INFO")} ${colorSuccessMessage(message)}`;
  console.log(line);
};
export const logWarn = (message: string): void => writeLog("WARN", message, ORANGE);
export const logError = (message: string): void => writeLog("ERROR", message, RED);

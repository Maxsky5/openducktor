export const formatTokenCompact = (value: number | null | undefined): string | null => {
  if (
    value === null ||
    value === undefined ||
    Number.isNaN(value) ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return null;
  }

  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1).replace(/\.0$/, "")}M`;
  }

  if (value >= 1_000) {
    const thousands = value / 1_000;
    if (Math.round(thousands) >= 1_000) {
      return "1M";
    }
    return `${thousands >= 100 ? Math.round(thousands) : thousands.toFixed(1).replace(/\.0$/, "")}K`;
  }

  return `${Math.round(value)}`;
};

// A shared formatter: `toLocaleString` builds a new one on each call.
const EXACT_TOKEN_FORMATTER = new Intl.NumberFormat("en-US");

export const formatTokenExact = (value: number | null | undefined): string | null => {
  if (
    value === null ||
    value === undefined ||
    Number.isNaN(value) ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    return null;
  }
  return EXACT_TOKEN_FORMATTER.format(Math.round(value));
};

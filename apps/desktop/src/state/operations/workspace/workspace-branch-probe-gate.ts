export type ProbeGateToken = number;

export type ProbeGateController = {
  begin: () => ProbeGateToken;
  finish: (token: ProbeGateToken) => void;
  isInFlight: () => boolean;
  reset: () => void;
};

export const createProbeGateController = (): ProbeGateController => {
  let nextToken = 0;
  let activeToken: ProbeGateToken | null = null;

  return {
    begin: () => {
      const token = ++nextToken;
      activeToken = token;
      return token;
    },
    finish: (token) => {
      if (activeToken === token) {
        activeToken = null;
      }
    },
    isInFlight: () => activeToken !== null,
    reset: () => {
      activeToken = null;
    },
  };
};

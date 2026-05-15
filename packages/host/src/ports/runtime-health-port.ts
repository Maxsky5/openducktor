import type { RuntimeHealth, RuntimeKind } from "@openducktor/contracts";

export type RuntimeHealthPort = {
  getRuntimeHealth(kind: RuntimeKind): Promise<RuntimeHealth>;
};

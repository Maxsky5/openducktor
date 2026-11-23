import { methods, type SessionConfigOption } from "@agentclientprotocol/sdk/unstable";
import type { AgentModelSelection } from "@openducktor/core";
import type { AntigravityAgentConnection } from "./antigravity-agent-connection";
import { ANTIGRAVITY_PROVIDER_ID } from "./antigravity-models";

/** The current `model` and `thought_level` config values of a native session. */
type AntigravityNativeModel = {
  readonly model: string | undefined;
  readonly thoughtLevel: string | undefined;
};

type AntigravityModelTarget = Pick<AgentModelSelection, "modelId" | "variant">;

const NO_NATIVE_MODEL: AntigravityNativeModel = { model: undefined, thoughtLevel: undefined };

/** Reads the current `model` and `thought_level` values from native config options. */
const readAntigravityNativeModel = (
  configOptions: readonly SessionConfigOption[] | null | undefined,
): AntigravityNativeModel => {
  const currentValue = (configId: string): string | undefined => {
    const option = configOptions?.find((candidate) => candidate.id === configId);
    return option?.type === "select" ? option.currentValue : undefined;
  };
  return { model: currentValue("model"), thoughtLevel: currentValue("thought_level") };
};

const sameNativeModel = (left: AntigravityNativeModel, right: AntigravityNativeModel) =>
  left.model === right.model && left.thoughtLevel === right.thoughtLevel;

/** The model selection that a session keeps, with the provider of every Antigravity model. */
const toAntigravityModelSelection = (
  model: AgentModelSelection | null,
): AgentModelSelection | undefined => {
  if (!model) return undefined;
  const selection: AgentModelSelection = {
    runtimeKind: "antigravity",
    providerId: ANTIGRAVITY_PROVIDER_ID,
    modelId: model.modelId,
  };
  if (model.variant) selection.variant = model.variant;
  return selection;
};

/**
 * Sets the model of a native session, then its thinking level when the target has one. Each write
 * gives the config options that Antigravity reports to `onReported`, also when a later write fails.
 */
export const setAntigravityNativeModel = async (
  connection: AntigravityAgentConnection,
  sessionId: string,
  model: AntigravityModelTarget,
  onReported: (configOptions: readonly SessionConfigOption[]) => void = () => undefined,
): Promise<void> => {
  const write = async (configId: "model" | "thought_level", value: string) => {
    const agent = connection.agent();
    const response = await connection.request(() =>
      agent.request(methods.agent.session.setConfigOption, { sessionId, configId, value }),
    );
    onReported(response.configOptions);
  };
  await write("model", model.modelId);
  if (model.variant) await write("thought_level", model.variant);
};

/**
 * The model of one live session: the OpenDucktor selection and the native values that Antigravity
 * reports. When a model change fails and the earlier native values cannot be restored, the session
 * refuses messages, so no turn runs on a model that the user did not select.
 */
export class AntigravitySessionModel {
  private native = NO_NATIVE_MODEL;
  /** The native values of the session when it opened, before any OpenDucktor selection. */
  private opened = NO_NATIVE_MODEL;
  private mismatch: string | null = null;
  private current: AgentModelSelection | undefined;

  constructor(
    private readonly connection: AntigravityAgentConnection,
    private readonly sessionId: string,
  ) {}

  get selection(): AgentModelSelection | undefined {
    return this.current;
  }

  /** Why the session refuses messages: its native model differs from the selected model. */
  get refusal(): string | null {
    return this.mismatch;
  }

  /** Keeps the native values that `session/new` or `session/load` reported. */
  open(configOptions: readonly SessionConfigOption[] | null | undefined): void {
    this.native = readAntigravityNativeModel(configOptions);
    this.opened = this.native;
  }

  /**
   * Selects a model. `null` restores the native values that the session had when it opened. When
   * a write fails after an earlier write of the change, the earlier native values are restored.
   */
  async select(model: AgentModelSelection | null): Promise<void> {
    const previous = this.native;
    if (!model) {
      if (!sameNativeModel(previous, this.opened)) await this.restore(this.opened);
    } else {
      try {
        await this.write(model);
      } catch (cause) {
        if (!sameNativeModel(this.native, previous)) await this.restore(previous);
        throw cause;
      }
    }
    this.mismatch = null;
    this.current = toAntigravityModelSelection(model);
  }

  private write(model: AntigravityModelTarget): Promise<void> {
    return setAntigravityNativeModel(this.connection, this.sessionId, model, (configOptions) => {
      this.native = readAntigravityNativeModel(configOptions);
    });
  }

  /**
   * Sets earlier native values again and checks that Antigravity reports them. Missing earlier
   * values cannot be restored, so they fail the check.
   */
  private async restore(target: AntigravityNativeModel): Promise<void> {
    try {
      if (target.model) {
        const model: AntigravityModelTarget = { modelId: target.model };
        if (target.thoughtLevel) model.variant = target.thoughtLevel;
        await this.write(model);
      }
      if (!target.model || !sameNativeModel(this.native, target)) {
        throw new Error("Antigravity did not report the earlier model values after the restore.");
      }
    } catch (cause) {
      this.mismatch = `Antigravity runs model '${this.native.model ?? "unknown"}', not the selected model of this session. Select the model again, then send the message.`;
      throw new Error(`Antigravity did not restore the earlier model. ${this.mismatch}`, {
        cause,
      });
    }
  }
}

import { describe, expect, test } from "bun:test";
import type {
  AgentSessionTodoItem,
  AgentSessionTodoPriority,
  AgentSessionTodoStatus,
  NormalizeAgentSessionTodoInput,
} from "./index";
import * as core from "./index";

type TodoNormalizerTypeContract = {
  AgentSessionTodoItem: AgentSessionTodoItem;
  AgentSessionTodoPriority: AgentSessionTodoPriority;
  AgentSessionTodoStatus: AgentSessionTodoStatus;
  NormalizeAgentSessionTodoInput: NormalizeAgentSessionTodoInput;
};

describe("core exports contract", () => {
  test("re-exports todo normalizers from the barrel", () => {
    expect(core.normalizeAgentSessionTodoItem).toBeInstanceOf(Function);
    expect(core.normalizeAgentSessionTodoList).toBeInstanceOf(Function);
    expect(core.normalizeAgentSessionTodoPriority).toBeInstanceOf(Function);
    expect(core.normalizeAgentSessionTodoStatus).toBeInstanceOf(Function);
  });

  test("keeps todo normalizer type exports importable from the barrel", () => {
    const compileOnlyTypeContract: TodoNormalizerTypeContract | null = null;
    expect(compileOnlyTypeContract).toBeNull();
  });
});

import { describeTaskStorePortContract } from "../../ports/task-store-port-contract.test-support";
import { createSqliteTaskStoreHarness } from "./sqlite-task-store-test-support";

describeTaskStorePortContract("SQLite TaskStorePort contract", createSqliteTaskStoreHarness);

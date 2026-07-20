import { describe, expect, test } from "bun:test";
import {
  createTerminalTitleSettler,
  type TerminalTitleSettlementScheduler,
} from "./terminal-title-settler";

const makeScheduler = () => {
  const scheduled = new Set<() => void>();
  const schedule: TerminalTitleSettlementScheduler = (_delay, settle) => {
    scheduled.add(settle);
    return () => scheduled.delete(settle);
  };
  return {
    schedule,
    flush: () => {
      const pending = [...scheduled];
      scheduled.clear();
      for (const settle of pending) settle();
    },
  };
};

describe("TerminalTitleSettler", () => {
  test("publishes only the latest title in a settlement window", () => {
    const scheduler = makeScheduler();
    const titles: string[] = [];
    const settler = createTerminalTitleSettler({
      onSettledTitle: (title) => titles.push(title),
      schedule: scheduler.schedule,
    });

    settler.offer("cd /tmp");
    settler.offer("/tmp");
    scheduler.flush();

    expect(titles).toEqual(["/tmp"]);
  });

  test("cancels pending work when disposed", () => {
    const scheduler = makeScheduler();
    const titles: string[] = [];
    const settler = createTerminalTitleSettler({
      onSettledTitle: (title) => titles.push(title),
      schedule: scheduler.schedule,
    });

    settler.offer("pnpm run dev");
    settler.dispose();
    scheduler.flush();

    expect(titles).toEqual([]);
  });
});

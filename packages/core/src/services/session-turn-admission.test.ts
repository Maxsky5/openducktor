import { expect, test } from "bun:test";
import { SessionTurnAdmission } from "./session-turn-admission";

test("a hold drains reserved preparations before settings can change", async () => {
  const gate = new SessionTurnAdmission();
  let finish!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const first = gate.run(async () => {
    entered();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  await started;
  let finishSecond!: () => void;
  let enterSecond!: () => void;
  const secondStarted = new Promise<void>((resolve) => {
    enterSecond = resolve;
  });
  const second = gate.run(async () => {
    enterSecond();
    await new Promise<void>((resolve) => {
      finishSecond = resolve;
    });
    return "reserved";
  });
  let held = false;
  const hold = gate.hold().then((release) => {
    held = true;
    return release;
  });
  await expect(gate.run(async () => "late")).rejects.toThrow("pending");
  expect(held).toBe(false);
  finish();
  await first;
  await secondStarted;
  expect(held).toBe(false);
  finishSecond();
  expect(await second).toBe("reserved");
  const release = await hold;
  expect(held).toBe(true);
  release();
  expect(await gate.run(async () => "next")).toBe("next");
});

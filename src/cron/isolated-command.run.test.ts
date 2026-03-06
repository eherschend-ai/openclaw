import { describe, expect, it } from "vitest";
import { runCronIsolatedExecCommand } from "./isolated-command/run.js";
import type { CronJob } from "./types.js";

function makeExecJob(overrides: Partial<CronJob["payload"]> = {}): CronJob {
  return {
    id: "exec-job",
    name: "exec-job",
    enabled: true,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    schedule: { kind: "every", everyMs: 60_000 },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: {
      kind: "execCommand",
      command: process.execPath,
      args: ["-e", "process.stdout.write('NO_REPLY')"],
      ...overrides,
    },
    delivery: { mode: "none" },
    state: {},
  };
}

describe("runCronIsolatedExecCommand", () => {
  it("executes direct commands deterministically and captures stdout", async () => {
    const result = await runCronIsolatedExecCommand({
      job: makeExecJob(),
    });

    expect(result.status).toBe("ok");
    expect(result.summary).toBe("NO_REPLY");
    expect(result.outputText).toBe("NO_REPLY");
  });

  it("returns errors for non-zero exit codes", async () => {
    const result = await runCronIsolatedExecCommand({
      job: makeExecJob({
        args: ["-e", "process.stderr.write('boom'); process.exit(2)"],
      }),
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("boom");
  });
});

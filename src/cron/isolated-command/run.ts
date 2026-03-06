import { spawn } from "node:child_process";
import type { CronJob, CronRunOutcome, CronRunTelemetry } from "../types.js";

export type RunCronExecCommandResult = {
  outputText?: string;
} & CronRunOutcome &
  CronRunTelemetry;

function trimOptional(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeArgs(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export async function runCronIsolatedExecCommand(params: {
  job: CronJob;
  abortSignal?: AbortSignal;
  signal?: AbortSignal;
}): Promise<RunCronExecCommandResult> {
  if (params.job.payload.kind !== "execCommand") {
    return { status: "error", error: 'execCommand runner requires payload.kind="execCommand"' };
  }

  const abortSignal = params.abortSignal ?? params.signal;
  const command = trimOptional(params.job.payload.command);
  if (!command) {
    return { status: "error", error: 'cron execCommand payload requires "command"' };
  }

  const args = normalizeArgs(params.job.payload.args);
  const cwd = trimOptional(params.job.payload.cwd);

  return await new Promise<RunCronExecCommandResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let child: ReturnType<typeof spawn> | null = null;
    let killTimer: NodeJS.Timeout | undefined;

    const finish = (result: RunCronExecCommandResult) => {
      if (settled) {
        return;
      }
      settled = true;
      if (killTimer) {
        clearTimeout(killTimer);
      }
      abortSignal?.removeEventListener("abort", onAbort);
      resolve(result);
    };

    const onAbort = () => {
      const reason =
        typeof abortSignal?.reason === "string" && abortSignal.reason.trim().length > 0
          ? abortSignal.reason.trim()
          : "cron: job execution timed out";
      try {
        child?.kill("SIGTERM");
      } catch {
        // no-op
      }
      killTimer = setTimeout(() => {
        try {
          child?.kill("SIGKILL");
        } catch {
          // no-op
        }
      }, 2_000);
      finish({
        status: "error",
        error: reason,
        summary: trimOptional(stdout) ?? trimOptional(stderr),
        outputText: stdout || undefined,
      });
    };

    try {
      child = spawn(command, args, {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      finish({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    abortSignal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      finish({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        summary: trimOptional(stderr) ?? trimOptional(stdout),
        outputText: stdout || undefined,
      });
    });
    child.on("close", (code, signal) => {
      const outputText = stdout || undefined;
      const summary = trimOptional(stdout) ?? trimOptional(stderr);
      if (code === 0) {
        finish({
          status: "ok",
          summary,
          outputText,
        });
        return;
      }
      const error =
        trimOptional(stderr) ??
        trimOptional(stdout) ??
        (signal ? `command terminated by signal ${signal}` : `command exited with code ${code ?? "unknown"}`);
      finish({
        status: "error",
        error,
        summary,
        outputText,
      });
    });
  });
}

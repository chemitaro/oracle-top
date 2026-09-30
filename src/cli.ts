#!/usr/bin/env node
import { createNodeTuiDependencies, runTui, type TuiInput } from "./tui.js";
import { parseInterval } from "./config.js";
import { homedir } from "node:os";
import type { Writable } from "node:stream";
import type { MonitorStartup } from "./config.js";
import type { CollectorFileSystem } from "./io/sessions.js";
import { collectInputs } from "./io/sessions.js";
import { buildDashboard } from "./aggregate.js";
import { serializeJson } from "./render/json.js";
import { renderText } from "./render/text.js";
export interface CliDependencies {
  startup?: MonitorStartup;
  stdin?: { isTTY?: boolean };
  stdout?: Writable & { isTTY?: boolean };
  stderr?: Writable;
  io?: CollectorFileSystem;
  now?: () => number;
  onLateExitCode?: (code: number) => void;
  runTui?: (startup: MonitorStartup, intervalMs: number) => Promise<number>;
}
const usage = "Invalid arguments. Use oracle-top --help.\n";
const help =
  "Usage: oracle-top [--interval VALUE]\n       oracle-top snapshot [--json]\n       oracle-top --help | --version\n";
export async function main(
  argv: readonly string[],
  deps: CliDependencies = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const stdin = deps.stdin ?? process.stdin;
  let output: Writable | undefined;
  try {
    const startup = deps.startup ?? {
      cwd: process.cwd(),
      osHome: homedir(),
      env: process.env,
    };
    const frozenStartup = {
      cwd: startup.cwd,
      osHome: startup.osHome,
      env: { ...startup.env },
    };
    const diagnostic =
      argv.length === 1 &&
      ["--help", "-h", "--version", "-V"].includes(argv[0]!);
    const snapshot =
      argv[0] === "snapshot" &&
      (argv.length === 1 || (argv.length === 2 && argv[1] === "--json"));
    const intervalArguments =
      argv.length === 2 && argv[0] === "--interval" ? [argv[1]!] : [];
    const interval = parseInterval(intervalArguments);
    const tui =
      argv.length === 0 ||
      (intervalArguments.length === 1 && interval.kind === "interval");
    if (!diagnostic && !snapshot && !tui) {
      output = stderr;
      await writeOutput(stderr, usage);
      return 2;
    }
    if (diagnostic) {
      output = stdout;
      await writeOutput(
        stdout,
        ["--help", "-h"].includes(argv[0]!) ? help : "0.1.0\n",
      );
      return 0;
    }
    if (
      tui &&
      (!stdin.isTTY ||
        !(stdout as Writable & { isTTY?: boolean }).isTTY ||
        frozenStartup.env.TERM === "dumb")
    ) {
      output = stderr;
      await writeOutput(
        stderr,
        "TUI requires stdin/stdout TTY and TERM other than dumb. Use oracle-top snapshot.\n",
      );
      return 2;
    }
    if (tui) {
      const intervalMs =
        interval.kind === "interval" ? interval.intervalMs : 2000;
      if (deps.runTui) return await deps.runTui(frozenStartup, intervalMs);
      return await runTui(
        createNodeTuiDependencies(
          { ...frozenStartup, intervalArguments },
          {
            terminal: {
              input: stdin as TuiInput,
              output: stdout,
              signals: process,
            },
            ...(deps.io ? { io: deps.io } : {}),
            ...(deps.now ? { now: deps.now } : {}),
            ...(deps.onLateExitCode
              ? { onLateExitCode: deps.onLateExitCode }
              : {}),
          },
        ),
        intervalMs,
      );
    }
    if (snapshot) {
      const result = await collectInputs(frozenStartup, {
        ...(deps.io ? { io: deps.io } : {}),
        ...(deps.now ? { now: deps.now } : {}),
      });
      if (result.kind === "usage-error") {
        output = stderr;
        await writeOutput(stderr, usage);
        return 2;
      }
      if (result.kind === "aborted") throw new Error("Collection aborted");
      output = stdout;
      await writeOutput(
        stdout,
        (argv.includes("--json") ? serializeJson : renderText)(
          buildDashboard(result.inputs, result.nowMs),
        ) + "\n",
      );
    }
    return 0;
  } catch (error: unknown) {
    if (
      output === stdout &&
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EPIPE"
    )
      return 0;
    if (!stderr.destroyed)
      await writeOutput(stderr, "Unable to produce snapshot.\n").catch(
        () => {},
      );
    return 1;
  }
}

if (import.meta.main) {
  let finalCode: number | undefined;
  const acceptCode = (code: number) => {
    if (finalCode !== 130 && finalCode !== 143) {
      finalCode =
        code === 130 || code === 143
          ? code
          : finalCode === 1 || code === 1
            ? 1
            : code;
    }
    process.exitCode = finalCode;
  };
  acceptCode(await main(process.argv.slice(2), { onLateExitCode: acceptCode }));
}

function writeOutput(stream: Writable, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let completed = false;
    let drained = true;
    let writing = true;
    let settled = false;
    const cleanup = () => {
      stream.off("error", onError);
      stream.off("drain", onDrain);
    };
    const finish = () => {
      if (!settled && !writing && completed && drained) {
        settled = true;
        cleanup();
        resolve();
      }
    };
    const onError = (error: Error) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(error);
      }
    };
    const onDrain = () => {
      drained = true;
      finish();
    };
    stream.on("error", onError);
    stream.on("drain", onDrain);
    try {
      drained = stream.write(value, (error) => {
        if (error) setImmediate(() => onError(error));
        else {
          completed = true;
          finish();
        }
      });
      writing = false;
      finish();
    } catch (error) {
      onError(error as Error);
    }
  });
}

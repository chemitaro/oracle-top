import { afterEach, beforeEach, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
const exec = promisify(execFile);
const cli = resolve("dist/cli.js");
let fixture: string;
let home: string;
let profile: string;
beforeEach(async () => {
  await mkdir(".workbench/p08", { recursive: true });
  fixture = await mkdtemp(resolve(".workbench/p08/fixture-"));
  home = join(fixture, "home");
  profile = join(fixture, "profile");
  await mkdir(join(home, "sessions"), { recursive: true });
  await mkdir(profile);
  await writeFile(join(home, "config.json"), "{}");
  await writeFile(
    join(profile, "oracle-tab-leases.json"),
    '{"version":1,"leases":[]}',
  );
});
afterEach(async () => {
  await rm(fixture, { recursive: true, force: true });
});
async function run(
  args: string[],
  options: { bin?: string; env?: NodeJS.ProcessEnv; nodeArgs?: string[] } = {},
) {
  try {
    const result = await exec(
      process.execPath,
      [...(options.nodeArgs ?? []), options.bin ?? cli, ...args],
      {
        cwd: fixture,
        env: {
          ...process.env,
          ORACLE_HOME_DIR: home,
          ORACLE_BROWSER_PROFILE_DIR: profile,
          ORACLE_BROWSER_MAX_CONCURRENT_TABS: "",
          TERM: "xterm",
          ...options.env,
          HOME: fixture,
        },
      },
    );
    return { stdout: result.stdout, stderr: result.stderr, code: 0 };
  } catch (error) {
    const failure = error as { stdout: string; stderr: string; code: number };
    return {
      stdout: failure.stdout,
      stderr: failure.stderr,
      code: failure.code,
    };
  }
}
test("shows-help-without-collection", async () => {
  expect(await run(["--help"])).toEqual({
    code: 0,
    stderr: "",
    stdout:
      "Usage: oracle-top [--interval VALUE]\n       oracle-top snapshot [--json]\n       oracle-top --help | --version\n",
  });
});
test("shows-version-without-collection", async () => {
  expect(await run(["--version"])).toEqual({
    code: 0,
    stderr: "",
    stdout: "0.1.0\n",
  });
});
test("emits-complete-text-snapshot", async () => {
  const result = await run(["snapshot"]);
  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("No current sessions\n");
  expect(result.stdout).toContain("No submitted messages\n");
  expect(result.stdout).toContain("Oracle-only submission-operation counts");
  expect(result.stdout).not.toContain("\u001b");
  expect(result.stdout.endsWith("\n")).toBe(true);
});
test("emits-one-json-document", async () => {
  const result = await run(["snapshot", "--json"]);
  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toMatch(/^\{[^\n]*\}\n$/);
  const snapshot = JSON.parse(result.stdout);
  expect(snapshot.schemaVersion).toBe(1);
  expect(snapshot.currentSessions).toEqual([]);
  expect(snapshot.browserCapacity).toEqual({
    active: 0,
    maximum: 3,
    utilization: 0,
    maximumSource: "default",
  });
  expect(snapshot.reliability24h).toEqual({
    completed: 0,
    partial: 0,
    error: 0,
    cancelled: 0,
    evaluated: 0,
    successRate: null,
  });
  expect(snapshot.submittedMessages).toEqual([]);
  expect(snapshot.dataWarnings).toEqual([]);
});
test("rejects-unapproved-argument-combinations", async () => {
  for (const args of [
    ["unknown"],
    ["--json"],
    ["--interval"],
    ["--interval", "2"],
    ["--interval", "2s", "--interval", "3s"],
    ["snapshot", "snapshot"],
    ["snapshot", "--json", "--json"],
    ["snapshot", "--interval", "2s"],
    ["--help", "snapshot"],
    ["--version", "--help"],
    ["--interval=2s"],
  ]) {
    expect(await run(args)).toEqual({
      code: 2,
      stdout: "",
      stderr: "Invalid arguments. Use oracle-top --help.\n",
    });
  }
});
test("rejects-non-tty-before-any-stdout", async () => {
  for (const args of [[], ["--interval", "002s"]]) {
    expect(await run(args)).toEqual({
      code: 2,
      stdout: "",
      stderr:
        "TUI requires stdin/stdout TTY and TERM other than dumb. Use oracle-top snapshot.\n",
    });
  }
});
test("succeeds-with-isolated-data-warnings", async () => {
  await mkdir(join(home, "sessions", "bad"));
  await writeFile(join(home, "sessions", "bad", "meta.json"), "{broken");
  const json = await run(["snapshot", "--json"]);
  expect(json.code).toBe(0);
  expect(json.stderr).toBe("");
  expect(JSON.parse(json.stdout).dataWarnings).toEqual([
    { source: "session", sessionId: "bad", code: "INVALID_JSON" },
  ]);
  expect(JSON.parse(json.stdout).currentSessions).toEqual([]);
  const text = await run(["snapshot"]);
  expect(text.code).toBe(0);
  expect(text.stderr).toBe("");
  expect(text.stdout).toContain("Values from readable records only\n");
  expect(text.stdout).toContain("session INVALID_JSON bad\n");
  expect(text.stdout).not.toContain("{broken");
});

async function scenario(body: string) {
  const path = join(fixture, "scenario.mjs");
  await writeFile(
    path,
    `
import {main} from ${JSON.stringify(pathToFileURL(cli).href)};
import {Writable} from "node:stream";
import {homedir} from "node:os";
function sink() {
  let text="";
  const stream=new Writable({write(chunk,encoding,done){text+=chunk.toString();done();}});
  return {stream,text:()=>text};
}
function deps(stdout,stderr) {
  return {stdout,stderr,startup:{cwd:process.cwd(),osHome:homedir(),env:{...process.env}},now:()=>1790748000000};
}
try {
${body}
} catch {process.stdout.write(JSON.stringify({unhandled:true}));}
`,
  );
  const result = await run([], { bin: path });
  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout);
}
test("isolates-default-home-even-without-startup-injection", async () => {
  await expect(
    scenario(`
const out=sink(),err=sink();
const code=await main(["snapshot","--json"],{stdout:out.stream,stderr:err.stream});
process.stdout.write(JSON.stringify({code,osHome:homedir(),home:process.env.ORACLE_HOME_DIR,profile:process.env.ORACLE_BROWSER_PROFILE_DIR,current:JSON.parse(out.text()).currentSessions,err:err.text()}));
`),
  ).resolves.toEqual({
    code: 0,
    osHome: fixture,
    home,
    profile,
    current: [],
    err: "",
  });
});
test("treats-stdout-epipe-as-success", async () => {
  await expect(
    scenario(`
const err=sink();
const out=new Writable({write(chunk,encoding,done){done(Object.assign(new Error("synthetic-private-detail"),{code:"EPIPE"}));}});
const code=await main(["snapshot","--json"],deps(out,err.stream));
process.stdout.write(JSON.stringify({code,destroyed:out.destroyed,err:err.text(),errors:out.listenerCount("error"),drains:out.listenerCount("drain")}));
`),
  ).resolves.toEqual({
    code: 0,
    destroyed: true,
    err: "",
    errors: 0,
    drains: 0,
  });
});
test("reports-other-output-failure-without-private-details", async () => {
  await expect(
    scenario(`
const err=sink();
const out=new Writable({write(chunk,encoding,done){done(Object.assign(new Error("synthetic-private-detail"),{code:"EIO"}));}});
const code=await main(["snapshot","--json"],deps(out,err.stream));
process.stdout.write(JSON.stringify({code,err:err.text(),errors:out.listenerCount("error"),drains:out.listenerCount("drain")}));
`),
  ).resolves.toEqual({
    code: 1,
    err: "Unable to produce snapshot.\n",
    errors: 0,
    drains: 0,
  });
});
test("waits-for-backpressure-and-flush-with-one-write", async () => {
  await expect(
    scenario(`
const err=sink();let writes=0,flushed=false;
const out=new Writable({highWaterMark:1,write(chunk,encoding,done){writes++;setTimeout(()=>{flushed=true;done();},25);}});
const code=await main(["snapshot","--json"],deps(out,err.stream));
process.stdout.write(JSON.stringify({code,writes,flushed,pending:out.writableLength,errors:out.listenerCount("error"),drains:out.listenerCount("drain"),err:err.text()}));
`),
  ).resolves.toEqual({
    code: 0,
    writes: 1,
    flushed: true,
    pending: 0,
    errors: 0,
    drains: 0,
    err: "",
  });
});
test("isolates-internal-exceptions-with-safe-exit-one", async () => {
  await expect(
    scenario(`
const out=sink(),err=sink();
const code=await main(["snapshot","--json"],{...deps(out.stream,err.stream),now:()=>{throw new Error("synthetic-private-detail");}});
process.stdout.write(JSON.stringify({code,out:out.text(),err:err.text()}));
`),
  ).resolves.toEqual({
    code: 1,
    out: "",
    err: "Unable to produce snapshot.\n",
  });
});
test("rejects-invalid-startup-values-with-usage-exit", async () => {
  await expect(
    scenario(`
const out=sink(),err=sink();const input=deps(out.stream,err.stream);
input.startup.env.ORACLE_HOME_DIR="bad\\0path";
const code=await main(["snapshot","--json"],input);
process.stdout.write(JSON.stringify({code,out:out.text(),err:err.text()}));
`),
  ).resolves.toEqual({
    code: 2,
    out: "",
    err: "Invalid arguments. Use oracle-top --help.\n",
  });
});
test("handles-diagnostic-output-errors-and-flush", async () => {
  await expect(
    scenario(`
let unhandled=false;process.on("uncaughtException",()=>{unhandled=true;});
const err=sink();
const out=new Writable({write(chunk,encoding,done){setTimeout(()=>done(Object.assign(new Error("synthetic-private-detail"),{code:"EIO"})),5);}});
const code=await main(["--help"],deps(out,err.stream));
await new Promise(resolve=>setTimeout(resolve,10));
process.stdout.write(JSON.stringify({code,err:err.text(),errors:out.listenerCount("error"),unhandled}));
`),
  ).resolves.toEqual({
    code: 1,
    err: "Unable to produce snapshot.\n",
    errors: 0,
    unhandled: false,
  });
});
test("contains-stderr-write-failure-with-exit-one", async () => {
  await expect(
    scenario(`
const out=sink();
const err=new Writable({write(chunk,encoding,done){done(Object.assign(new Error("synthetic-private-detail"),{code:"EIO"}));}});
const code=await main(["unknown"],deps(out.stream,err));
process.stdout.write(JSON.stringify({code,out:out.text(),errors:err.listenerCount("error"),drains:err.listenerCount("drain")}));
`),
  ).resolves.toEqual({ code: 1, out: "", errors: 0, drains: 0 });
});
test("connects-valid-tty-to-injected-runner-with-parsed-interval", async () => {
  await expect(
    scenario(`
const out=sink(),err=sink();out.stream.isTTY=true;
let received=null;
const code=await main(["--interval","003s"],{...deps(out.stream,err.stream),stdin:{isTTY:true},runTui:async(startup,intervalMs)=>{received={cwd:startup.cwd,osHome:startup.osHome,home:startup.env.ORACLE_HOME_DIR,intervalMs};return 143;}});
process.stdout.write(JSON.stringify({code,received,out:out.text(),err:err.text()}));
`),
  ).resolves.toEqual({
    code: 143,
    received: { cwd: fixture, osHome: fixture, home, intervalMs: 3000 },
    out: "",
    err: "",
  });
});
test("requires-both-tty-streams-and-nondumb-term", async () => {
  await expect(
    scenario(`
const results=[];
for(const [inputTTY,outputTTY,term] of [[false,true,"xterm"],[true,false,"xterm"],[true,true,"dumb"]]) {
 const out=sink(),err=sink();out.stream.isTTY=outputTTY;const input=deps(out.stream,err.stream);input.startup.env.TERM=term;
 const code=await main([],{...input,stdin:{isTTY:inputTTY},runTui:async()=>{throw new Error("Runner must not start");}});
 results.push({code,out:out.text(),err:err.text()});
}
process.stdout.write(JSON.stringify(results));
`),
  ).resolves.toEqual(
    Array(3).fill({
      code: 2,
      out: "",
      err: "TUI requires stdin/stdout TTY and TERM other than dumb. Use oracle-top snapshot.\n",
    }),
  );
});
test("diagnostics-and-usage-do-not-collect", async () => {
  await expect(
    scenario(`
const results=[];
for(const args of [["-h"],["-V"],["unknown"]]){
 const out=sink(),err=sink();
 const code=await main(args,{...deps(out.stream,err.stream),now:()=>{throw new Error("Must not collect");}});
 results.push({code,err:err.text(),out:out.text()});
}
process.stdout.write(JSON.stringify(results));
`),
  ).resolves.toEqual([
    {
      code: 0,
      err: "",
      out: "Usage: oracle-top [--interval VALUE]\n       oracle-top snapshot [--json]\n       oracle-top --help | --version\n",
    },
    { code: 0, err: "", out: "0.1.0\n" },
    { code: 2, err: "Invalid arguments. Use oracle-top --help.\n", out: "" },
  ]);
});
test("snapshots-startup-and-collects-clock-once", async () => {
  await expect(
    scenario(`
const out=sink(),err=sink();const input=deps(out.stream,err.stream);let clocks=0;
input.now=()=>{clocks++;input.startup.env.ORACLE_HOME_DIR="relative-other-home";return 1790748000000;};
const code=await main(["snapshot","--json"],input);const value=JSON.parse(out.text());
process.stdout.write(JSON.stringify({code,clocks,generatedAt:value.generatedAt,current:value.currentSessions,warnings:value.dataWarnings,err:err.text()}));
`),
  ).resolves.toEqual({
    code: 0,
    clocks: 1,
    generatedAt: "2026-09-30T06:00:00.000Z",
    current: [],
    warnings: [],
    err: "",
  });
});
test("help-and-version-epipe-are-success", async () => {
  await expect(
    scenario(`
const results=[];
for(const args of [["--help"],["--version"]]){
 const err=sink();const out=new Writable({write(chunk,encoding,done){setTimeout(()=>done(Object.assign(new Error("synthetic-private-detail"),{code:"EPIPE"})),5);}});
 const code=await main(args,deps(out,err.stream));
 results.push({code,err:err.text(),errors:out.listenerCount("error"),drains:out.listenerCount("drain")});
}
process.stdout.write(JSON.stringify(results));
`),
  ).resolves.toEqual([
    { code: 0, err: "", errors: 0, drains: 0 },
    { code: 0, err: "", errors: 0, drains: 0 },
  ]);
});
test("defines-distribution-bin-and-runs-symlink-entry", async () => {
  const { readFile, symlink } = await import("node:fs/promises");
  const packageFile = JSON.parse(
    await readFile(resolve("package.json"), "utf8"),
  );
  expect(packageFile.bin).toEqual({ "oracle-top": "dist/cli.js" });
  expect(packageFile.files).toEqual(["dist", "README.md"]);
  expect(packageFile.private).toBe(true);
  expect(Object.keys(packageFile.dependencies).sort()).toEqual([
    "json5",
    "string-width",
  ]);
  expect(await readFile(cli, "utf8")).toMatch(/^#!\/usr\/bin\/env node\n/);
  const link = join(fixture, "oracle-top");
  await symlink(cli, link);
  expect(await run(["--version"], { bin: link })).toEqual({
    code: 0,
    stderr: "",
    stdout: "0.1.0\n",
  });
});
test("rejects-incomplete-terminal-adapter-with-safe-exit", async () => {
  await expect(
    scenario(`
const out=sink(),err=sink();out.stream.isTTY=true;
const code=await main([],{...deps(out.stream,err.stream),stdin:{isTTY:true}});
process.stdout.write(JSON.stringify({code,out:out.text(),err:err.text()}));
`),
  ).resolves.toEqual({
    code: 1,
    out: "",
    err: "Unable to produce snapshot.\n",
  });
});
test("built-snapshot-keeps-all-rows-and-all-warnings", async () => {
  for (let index = 0; index < 12; index++) {
    const id = `session-${String(index).padStart(2, "0")}`;
    await mkdir(join(home, "sessions", id));
    await writeFile(
      join(home, "sessions", id, "meta.json"),
      JSON.stringify({
        id,
        mode: "browser",
        model: "gpt-6-astra",
        status: "running",
        cwd: fixture,
        startedAt: new Date(Date.now() - 60000).toISOString(),
        options: {
          slug: `slug-${index}`,
          browserConfig: {
            thinkingTime: "high",
            manualLoginProfileDir: profile,
            maxConcurrentTabs: 3,
          },
        },
        browser: { runtime: { promptSubmitted: true } },
      }),
    );
  }
  for (const id of ["bad-a", "bad-b", "bad-c"]) {
    await mkdir(join(home, "sessions", id));
    await writeFile(join(home, "sessions", id, "meta.json"), "{broken");
  }
  const json = await run(["snapshot", "--json"]);
  expect(json.code).toBe(0);
  expect(json.stderr).toBe("");
  const value = JSON.parse(json.stdout);
  expect(value.currentSessions).toHaveLength(12);
  expect(value.submittedMessages).toEqual([
    { model: "gpt-6-astra", effort: "high", submitted24h: 12, submitted7d: 12 },
  ]);
  expect(value.dataWarnings).toEqual(
    ["bad-a", "bad-b", "bad-c"].map((sessionId) => ({
      source: "session",
      sessionId,
      code: "INVALID_JSON",
    })),
  );
  const text = await run(["snapshot"]);
  expect(text.code).toBe(0);
  expect(text.stderr).toBe("");
  for (let index = 0; index < 12; index++)
    expect(text.stdout).toContain(`slug-${index}`);
  for (const id of ["bad-a", "bad-b", "bad-c"])
    expect(text.stdout).toContain(`session INVALID_JSON ${id}\n`);
  expect(text.stdout).not.toContain("more; use");
  expect(text.stdout).not.toContain("\u001b");
});
test("contains-error-event-during-pending-output-with-no-late-write", async () => {
  await expect(
    scenario(`
const err=sink();let writes=0,late=false;let out;
out=new Writable({highWaterMark:1,write(chunk,encoding,done){writes++;setTimeout(()=>out.emit("error",Object.assign(new Error("synthetic-private-detail"),{code:"EPIPE"})),5);setTimeout(()=>{late=true;done();},15);}});
const code=await main(["snapshot","--json"],deps(out,err.stream));
await new Promise(resolve=>setTimeout(resolve,25));
process.stdout.write(JSON.stringify({code,writes,late,errors:out.listenerCount("error"),drains:out.listenerCount("drain"),err:err.text()}));
`),
  ).resolves.toEqual({
    code: 0,
    writes: 1,
    late: true,
    errors: 0,
    drains: 0,
    err: "",
  });
});
test("built-cli-exits-zero-when-output-pipe-closes", async () => {
  for (let index = 0; index < 8; index++) {
    const id = `large-${index}`;
    await mkdir(join(home, "sessions", id));
    await writeFile(
      join(home, "sessions", id, "meta.json"),
      JSON.stringify({
        id,
        mode: "browser",
        model: "gpt-6-astra",
        status: "running",
        cwd: fixture,
        options: {
          slug: "x".repeat(150000),
          browserConfig: {
            thinkingTime: "high",
            manualLoginProfileDir: profile,
            maxConcurrentTabs: 3,
          },
        },
      }),
    );
  }
  await expect(
    scenario(`
const {spawn}=await import("node:child_process");
const child=spawn(process.execPath,[${JSON.stringify(cli)},"snapshot","--json"],{stdio:["ignore","pipe","pipe"],env:process.env});
let err="";child.stderr.on("data",chunk=>{err+=chunk;});child.stdout.destroy();
const result=await new Promise(resolve=>child.on("close",(code,signal)=>resolve({code,signal,err})));
process.stdout.write(JSON.stringify(result));
`),
  ).resolves.toEqual({ code: 0, signal: null, err: "" });
});

test("connects-default-runner-to-node-adapters-and-restores-input", async () => {
  await expect(
    scenario(`
const {PassThrough}=await import("node:stream");
const input=new PassThrough();input.isTTY=true;input.isRaw=false;input.setRawMode=value=>{input.isRaw=value;};
let text="";const out=new Writable({write(chunk,encoding,done){text+=chunk.toString();if(chunk.toString().startsWith("\\u001b[H"))setImmediate(()=>input.write("q"));done();}});out.isTTY=true;out.columns=120;out.rows=32;
const err=sink();
const code=await main([],{...deps(out,err.stream),stdin:input});
process.stdout.write(JSON.stringify({code,raw:input.isRaw,paused:input.isPaused(),current:text.includes("No current sessions"),entered:text.includes("\\u001b[?1049h"),restored:text.includes("\\u001b[?1049l"),err:err.text()}));
`),
  ).resolves.toEqual({
    code: 0,
    raw: false,
    paused: true,
    current: true,
    entered: true,
    restored: true,
    err: "",
  });
});

async function entryOutputFailure(delay: number, signal = false) {
  const preload = join(fixture, "terminal-preload.mjs");
  await writeFile(
    preload,
    `
Object.defineProperty(process.stdin,"isTTY",{value:true});
process.stdin.isRaw=false;process.stdin.setRawMode=value=>{process.stdin.isRaw=value;};
Object.defineProperty(process.stdout,"isTTY",{value:true});
process.stdout.columns=120;process.stdout.rows=32;
let frameCallback,restoreCallback;
process.stdout.write=(value,callback)=>{
 if(value.startsWith("\\u001b[?1049h")){callback?.();return true;}
 if(value.startsWith("\\u001b[H")){
  frameCallback=callback;
  queueMicrotask(()=>{
   ${signal ? 'process.emit("SIGTERM");' : 'process.stdin.emit("data",Buffer.from("q"));'}
   const fail=()=>{const error=Object.assign(new Error("synthetic-private-detail"),{code:"EIO"});process.stdout.emit("error",error);frameCallback?.(error);restoreCallback?.(error);};
   ${delay === 0 ? "fail();" : `setTimeout(fail,${delay});`}
  });
  return false;
 }
 if(value.includes("\\u001b[?1049l")){restoreCallback=callback;return false;}
 return true;
};
`,
  );
  return run([], { nodeArgs: ["--import", preload] });
}
test("entry-keeps-early-late-error-instead-of-overwriting-with-main-zero", async () => {
  await expect(entryOutputFailure(0)).resolves.toEqual({
    code: 1,
    stdout: "",
    stderr: "",
  });
});
test("entry-reflects-delayed-output-error-in-final-process-code", async () => {
  await expect(entryOutputFailure(10)).resolves.toEqual({
    code: 1,
    stdout: "",
    stderr: "",
  });
});
test("entry-keeps-signal-code-after-late-output-error", async () => {
  await expect(entryOutputFailure(10, true)).resolves.toEqual({
    code: 143,
    stdout: "",
    stderr: "",
  });
});
test("node-collector-rereads-config-with-fixed-startup", async () => {
  await expect(
    scenario(`
const {createNodeTuiDependencies}=await import(new URL("./tui.js",${JSON.stringify(pathToFileURL(cli).href)}));
const {writeFile}=await import("node:fs/promises");
const startup={cwd:process.cwd(),osHome:homedir(),env:{...process.env}};let clocks=0;
const adapter=createNodeTuiDependencies(startup,{now:()=>{clocks++;return 1790748000000;}});
const first=await adapter.collect(new AbortController().signal);
startup.env.ORACLE_HOME_DIR=process.cwd()+"/absent-other-home";
await writeFile(process.env.ORACLE_HOME_DIR+"/config.json",'{browser:{maxConcurrentTabs:4}}');
const second=await adapter.collect(new AbortController().signal);
process.stdout.write(JSON.stringify({clocks,first:first.snapshot.browserCapacity,second:second.snapshot.browserCapacity,current:second.snapshot.currentSessions,warnings:second.snapshot.dataWarnings}));
`),
  ).resolves.toEqual({
    clocks: 2,
    first: { active: 0, maximum: 3, maximumSource: "default", utilization: 0 },
    second: {
      active: 0,
      maximum: 4,
      maximumSource: "user-config",
      utilization: 0,
    },
    current: [],
    warnings: [],
  });
});

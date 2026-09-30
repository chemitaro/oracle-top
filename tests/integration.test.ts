import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
let root: string;
beforeEach(async () => {
  await mkdir(join(process.cwd(), ".workbench/p10"), { recursive: true });
  root = await mkdtemp(join(process.cwd(), ".workbench/p10/integration-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
function env() {
  return {
    ...process.env,
    HOME: root,
    ORACLE_HOME_DIR: join(root, "home"),
    ORACLE_BROWSER_PROFILE_DIR: join(root, "profile"),
    ORACLE_BROWSER_MAX_CONCURRENT_TABS: "",
  };
}
test("reads-complete-snapshot-without-changing-fixture-or-opening-unrelated-files", async () => {
  const code = `import {createFixture,inventory,FIXED_NOW,fixtureEnv} from "./scripts/fixture.mjs";
  import {writeFile,mkdir} from "node:fs/promises";
  import {collectInputs,nodeCollectorFileSystem} from "./dist/io/sessions.js";
  import {buildDashboard} from "./dist/aggregate.js";
  import {execFileSync} from "node:child_process";
  const fixture=await createFixture(process.argv[1],{count:40});
  await writeFile(fixture.home+"/sessions/synthetic-0000/oracle.log","SYNTHETIC_LOG_MARKER");
  await mkdir(fixture.root+"/other-profile");
  await writeFile(fixture.root+"/other-profile/oracle-tab-leases.json","SYNTHETIC_OTHER_MARKER");
  const before=await inventory(fixture.root), opened=[];
  const io={...nodeCollectorFileSystem,open(path,flags){opened.push(path);return nodeCollectorFileSystem.open(path,flags);}};
  const result=await collectInputs({cwd:fixture.root,osHome:fixture.root,env:fixtureEnv(fixture)},{io,now:()=>FIXED_NOW});
  const snapshot=buildDashboard(result.inputs,result.nowMs);
  const output=execFileSync(process.execPath,["dist/cli.js","snapshot","--json"],{env:fixtureEnv(fixture),encoding:"utf8"});
  console.log(JSON.stringify({current:snapshot.currentSessions.length,submitted:snapshot.submittedMessages[0].submitted7d,
    reliability:snapshot.reliability24h,active:snapshot.browserCapacity.active,warnings:snapshot.dataWarnings,
    unchanged:JSON.stringify(before)===JSON.stringify(await inventory(fixture.root)),
    unrelated:opened.some(p=>p.endsWith("oracle.log")||p.includes("other-profile")),
    documentCount:output.trim().split("\\n").length,jsonCurrent:JSON.parse(output).currentSessions.length}));`;
  const result = await execute(
    process.execPath,
    ["--input-type=module", "-e", code, root],
    { env: env() },
  );
  expect(JSON.parse(result.stdout)).toEqual({
    current: 20,
    submitted: 40,
    reliability: {
      completed: 20,
      partial: 0,
      error: 0,
      cancelled: 0,
      evaluated: 20,
      successRate: 1,
    },
    active: 0,
    warnings: [],
    unchanged: true,
    unrelated: false,
    documentCount: 1,
    jsonCurrent: 20,
  });
});
test("production-imports-and-capabilities-exclude-forbidden-effects", async () => {
  const sources: string[] = [];
  async function walk(path: string) {
    for (const name of await readdir(path, { withFileTypes: true })) {
      if (name.isDirectory()) await walk(join(path, name.name));
      else if (name.name.endsWith(".ts"))
        sources.push(await readFile(join(path, name.name), "utf8"));
    }
  }
  await walk("src");
  expect(sources.join("\n")).not.toMatch(
    /node:(?:child_process|https?|net|tls|dns|dgram)|\b(?:fetch|WebSocket|writeFile|appendFile|unlink|rmSync|mkdir|rename|execFile|spawn|kill)\s*\(/,
  );
  const reader = await readFile("src/io/json-reader.ts", "utf8");
  expect(reader).toContain(
    "constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK",
  );
  expect(reader).not.toMatch(/\b(?:write|truncate|chmod|unlink)\s*\(/);
});

test("rejects-pack-contents-outside-public-allowlist", async () => {
  const code = `import {allowedPackFiles} from "./scripts/smoke-cli.mjs";
    console.log(JSON.stringify([allowedPackFiles(["package.json","README.md","dist/cli.js"]),
      allowedPackFiles(["package.json",".workbench/fixture/meta.json"]),allowedPackFiles(["dist/../secret"])]));`;
  const result = await execute(
    process.execPath,
    ["--input-type=module", "-e", code],
    { env: env() },
  );
  expect(JSON.parse(result.stdout)).toEqual([true, false, false]);
});

test("real-worker-preserves-one-mib-unicode-document-and-poll-config", async () => {
  const code = `import {createFixture,FIXED_NOW,fixtureEnv} from './scripts/fixture.mjs';import {writeFile} from 'node:fs/promises';import {createInputCollector} from './dist/io/collector.js';
 const f=await createFixture(process.argv[1],{count:1});
 const file=f.home+'/sessions/synthetic-0000/meta.json';
 const doc={mode:'browser',model:'gpt-6-保存é👨‍👩‍👧‍👦',status:'running',cwd:f.root,startedAt:'2026-09-30T05:58:00.000Z',browser:{runtime:{promptSubmitted:true}},options:{slug:'日本語',browserConfig:{thinkingTime:'未知 effort'}}};
 doc.padding='x'.repeat(1048576-Buffer.byteLength(JSON.stringify({...doc,padding:''})));await writeFile(file,JSON.stringify(doc));
 let clocks=0;const metrics=[];const c=createInputCollector({env:fixtureEnv(f),cwd:f.root,osHome:f.root},{now:()=>{clocks++;return FIXED_NOW;},onMetrics:m=>metrics.push(m)});
 try{const first=await c.collect(new AbortController().signal);await writeFile(f.home+'/config.json','{browser:{maxConcurrentTabs:7}}');const second=await c.collect(new AbortController().signal);
 console.log(JSON.stringify({kinds:[first.kind,second.kind],saved:first.inputs?.sessions?.map(s=>[s.model,s.effort,s.slug]),maximum:second.inputs?.config.fallbackMaximum,clocks,metrics}));}finally{c.stop();}`;
  const result = await execute(
    process.execPath,
    ["--input-type=module", "-e", code, root],
    { env: env() },
  );
  expect(JSON.parse(result.stdout)).toMatchObject({
    kinds: ["inputs", "inputs"],
    saved: [["gpt-6-保存é👨‍👩‍👧‍👦", "未知 effort", "日本語"]],
    maximum: 7,
    clocks: 2,
  });
});
test("reports-only-bounded-read-metrics-through-real-worker", async () => {
  const code = `import {createFixture,FIXED_NOW,fixtureEnv} from './scripts/fixture.mjs';import {createInputCollector} from './dist/io/collector.js';
 const f=await createFixture(process.argv[1],{count:1});const metrics=[];const c=createInputCollector({env:fixtureEnv(f),cwd:f.root,osHome:f.root},{now:()=>FIXED_NOW,onMetrics:m=>metrics.push(m)});
 try{await c.collect(new AbortController().signal);await c.collect(new AbortController().signal);console.log(JSON.stringify(metrics.map(m=>({keys:Object.keys(m).sort(),peak:m.readPeak,calls:m.readCalls,allocated:m.bufferAllocatedBytes>0}))));}finally{c.stop();}`;
  const result = await execute(
    process.execPath,
    ["--input-type=module", "-e", code, root],
    { env: env() },
  );
  expect(JSON.parse(result.stdout)).toEqual([
    {
      keys: ["bufferAllocatedBytes", "readCalls", "readPeak"],
      peak: 1,
      calls: 3,
      allocated: true,
    },
    {
      keys: ["bufferAllocatedBytes", "readCalls", "readPeak"],
      peak: 1,
      calls: 3,
      allocated: false,
    },
  ]);
});

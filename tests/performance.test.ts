import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
let root: string;
beforeEach(async () => {
  await mkdir(join(process.cwd(), ".workbench/p10"), { recursive: true });
  root = await mkdtemp(join(process.cwd(), ".workbench/p10/test-"));
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
  };
}
test("waits-until-grid-after-early-timer-wake", async () => {
  const code = `import {waitUntil} from './scripts/performance.mjs';
    const clock=[1999.25,1999.75,2000], waits=[];
    let current=clock.shift();
    await waitUntil(2000,{now:()=>current,sleep:async ms=>{waits.push(ms);current=clock.shift();}});
    console.log(JSON.stringify({waits,finalNow:current}));`;
  const result = await execute(
    process.execPath,
    ["--input-type=module", "-e", code],
    { env: env() },
  );
  expect(JSON.parse(result.stdout)).toEqual({ waits: [1, 1], finalNow: 2000 });
});
test("waits-through-final-measurement-deadline", async () => {
  const code = `import {waitUntil} from './scripts/performance.mjs';
    const clock=[59999.25,59999.75,60000], waits=[];
    let current=clock.shift();
    await waitUntil(60000,{now:()=>current,sleep:async ms=>{waits.push(ms);current=clock.shift();}});
    console.log(JSON.stringify({waits,finalNow:current}));`;
  const result = await execute(
    process.execPath,
    ["--input-type=module", "-e", code],
    { env: env() },
  );
  expect(JSON.parse(result.stdout)).toEqual({ waits: [1, 1], finalNow: 60000 });
});
test("creates-thousand-bounded-synthetic-metadata-files", async () => {
  const result = await execute(
    process.execPath,
    ["scripts/performance.mjs", root],
    { env: env() },
  );
  expect(JSON.parse(result.stdout)).toMatchObject({
    count: 1000,
    maximumBytes: 16384,
  });
});

test("evaluates-fixed-performance-budgets-with-one-core-cpu", async () => {
  const code = `import { summarizeMeasurement } from "./scripts/performance.mjs";
    console.log(JSON.stringify(summarizeMeasurement([100,400,200,300], {user:1000000,system:2000000},60000,104857600,1,8)));`;
  const result = await execute(
    process.execPath,
    ["--input-type=module", "-e", code],
    { env: env() },
  );
  expect(JSON.parse(result.stdout)).toEqual({
    cpuPercent: 5,
    peakRssMiB: 100,
    p95Ms: 400,
    scanPeak: 1,
    readPeak: 8,
    passed: true,
  });
});

test("rejects-each-budget-overrun-without-relaxing-limits", async () => {
  const code = `import {summarizeMeasurement as score} from "./scripts/performance.mjs";
  console.log(JSON.stringify([
    score([100],{user:3000001,system:0},60000,104857600,1,8).passed,
    score([100],{user:0,system:0},60000,157286401,1,8).passed,
    score([501],{user:0,system:0},60000,104857600,1,8).passed,
    score([100],{user:0,system:0},60000,104857600,2,8).passed,
    score([100],{user:0,system:0},60000,104857600,1,9).passed]));`;
  const result = await execute(
    process.execPath,
    ["--input-type=module", "-e", code],
    { env: env() },
  );
  expect(JSON.parse(result.stdout)).toEqual([
    false,
    false,
    false,
    false,
    false,
  ]);
});

test("dates-development-fixture-relative-to-explicit-clock", async () => {
  const code = `import {createFixture} from './scripts/fixture.mjs';import {readFile} from 'node:fs/promises';
    const f=await createFixture(${JSON.stringify(root)}, {count:1,nowMs:1893456000000});
    const d=JSON.parse(await readFile(f.home+'/sessions/synthetic-0000/meta.json','utf8'));
    console.log(JSON.stringify([d.startedAt,d.createdAt,d.completedAt]));`;
  const result = await execute(
    process.execPath,
    ["--input-type=module", "-e", code],
    { env: env() },
  );
  expect(JSON.parse(result.stdout)).toEqual([
    "2029-12-31T23:58:00.000Z",
    "2029-12-31T23:58:00.000Z",
    "2029-12-31T23:59:00.000Z",
  ]);
});

import { createFixture } from "./fixture.mjs";
export async function waitUntil(targetMs, { now, sleep }) {
  for (
    let remaining = targetMs - now();
    remaining > 0;
    remaining = targetMs - now()
  ) {
    await sleep(Math.max(1, Math.ceil(remaining)));
  }
}
export function summarizeMeasurement(
  samples,
  cpu,
  wallMs,
  rssBytes,
  scanPeak,
  readPeak,
) {
  const cpuPercent = ((cpu.user + cpu.system) / (wallMs * 1000)) * 100;
  const peakRssMiB = rssBytes / 1048576;
  const ordered = [...samples].sort((a, b) => a - b);
  const p95Ms = ordered[Math.ceil(ordered.length * 0.95) - 1];
  return {
    cpuPercent,
    peakRssMiB,
    p95Ms,
    scanPeak,
    readPeak,
    passed:
      cpuPercent <= 5 &&
      peakRssMiB <= 150 &&
      p95Ms <= 500 &&
      scanPeak === 1 &&
      readPeak <= 8,
  };
}
if (import.meta.main) {
  if (process.argv[2] !== "--measure") {
    console.log(
      JSON.stringify(
        await createFixture(process.argv[2], { count: 1000, padded: true }),
      ),
    );
  } else {
    await measure(process.argv[3], process.argv[4]);
  }
}
async function measure(root, output) {
  const { execFileSync } = await import("node:child_process");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join, resolve } = await import("node:path");
  root = resolve(root);
  const { platform, release, arch, totalmem, cpus } = await import("node:os");
  const { createHash } = await import("node:crypto");
  const { fixtureEnv, FIXED_NOW } = await import("./fixture.mjs");
  const { createInputCollector } = await import("../dist/io/collector.js");
  const { buildDashboard } = await import("../dist/aggregate.js");
  const { renderText } = await import("../dist/render/text.js");
  await mkdir(root, { recursive: true });
  const safeFixture = {
    root,
    home: join(root, "home"),
    profile: join(root, "profile"),
  };
  const fixture = JSON.parse(
    execFileSync(process.execPath, ["scripts/performance.mjs", root], {
      env: fixtureEnv(safeFixture),
      encoding: "utf8",
    }),
  );
  const prepareCode = `import {inventory} from './scripts/fixture.mjs';import {createHash} from 'node:crypto';
    const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const content=rows=>rows.map(({path,hash})=>({path,hash}));
    console.log(JSON.stringify({inputHash:hash(await inventory(process.argv[1])),sourceSha256:hash(content(await inventory('src'))),distSha256:hash(content(await inventory('dist')))}));`;
  const prepared = JSON.parse(
    execFileSync(
      process.execPath,
      ["--input-type=module", "-e", prepareCode, root],
      { env: fixtureEnv(fixture), encoding: "utf8" },
    ),
  );
  let readPeak = 0,
    liveScans = 0,
    scanPeak = 0,
    allocationBytes = 0,
    readCalls = 0;
  const startup = { cwd: root, osHome: root, env: fixtureEnv(fixture) };
  const collector = createInputCollector(startup, {
    now: () => FIXED_NOW,
    onMetrics(metrics) {
      readPeak = Math.max(readPeak, metrics.readPeak);
      readCalls += metrics.readCalls;
      allocationBytes += metrics.bufferAllocatedBytes;
    },
  });
  const samples = [],
    phases = [];
  const intervalMs = 2000,
    durationMs = 60000;
  const base = performance.now(),
    cpuStart = process.cpuUsage();
  while (performance.now() - base < durationMs) {
    const start = performance.now();
    liveScans++;
    scanPeak = Math.max(scanPeak, liveScans);
    const cpuScan = process.cpuUsage();
    const result = await collector.collect(new AbortController().signal);
    if (result.kind !== "inputs")
      throw new Error("Synthetic collection failed");
    const collected = performance.now(),
      cpuCollected = process.cpuUsage(cpuScan);
    const snapshot = buildDashboard(result.inputs, result.nowMs);
    const aggregated = performance.now();
    const cpuRenderStart = process.cpuUsage();
    const text = renderText(snapshot, { columns: 120, rows: 32 });
    const done = performance.now();
    const cpuRendered = process.cpuUsage(cpuRenderStart);
    liveScans--;
    if (
      snapshot.currentSessions.length !== 500 ||
      snapshot.submittedMessages[0].submitted7d !== 1000 ||
      snapshot.dataWarnings.length !== 0 ||
      text.split("\n").length > 31
    )
      throw new Error("Synthetic result mismatch");
    samples.push(done - start);
    phases.push({
      collectMs: collected - start,
      aggregateMs: aggregated - collected,
      renderMs: done - aggregated,
      collectCpuUs: cpuCollected.user + cpuCollected.system,
      collectCpuUserUs: cpuCollected.user,
      collectCpuSystemUs: cpuCollected.system,
      renderCpuUserUs: cpuRendered.user,
      renderCpuSystemUs: cpuRendered.system,
    });
    const next =
      base + (Math.floor((done - base) / intervalMs) + 1) * intervalMs;
    await waitUntil(Math.min(next, base + durationMs), {
      now: () => performance.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
  }
  const wallMs = performance.now() - base,
    cpu = process.cpuUsage(cpuStart);
  const summary = summarizeMeasurement(
    samples,
    cpu,
    wallMs,
    process.resourceUsage().maxRSS * 1024,
    scanPeak,
    readPeak,
  );
  collector.stop();
  const afterHash = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {inventory} from './scripts/fixture.mjs';import {createHash} from 'node:crypto';console.log(JSON.stringify(createHash('sha256').update(JSON.stringify(await inventory(process.argv[1]))).digest('hex')));`,
        root,
      ],
      { env: fixtureEnv(fixture), encoding: "utf8" },
    ),
  );
  const unchanged = prepared.inputHash === afterHash;
  const receipt = {
    ...summary,
    durationMs,
    intervalMs,
    wallMs,
    cpu,
    scanCount: samples.length,
    initialMs: samples[0],
    samples,
    phases,
    allocationBytes,
    readCalls,
    fixture: {
      count: fixture.count,
      maximumBytes: fixture.maximumBytes,
      inputHash: prepared.inputHash,
      unchanged,
    },
    sourceHash: createHash("sha256")
      .update(prepared.sourceSha256)
      .update(prepared.distSha256)
      .digest("hex"),
    sourceSha256: prepared.sourceSha256,
    distSha256: prepared.distSha256,
    environment: {
      node: process.version,
      npm: "11.18.0",
      platform: platform(),
      release: release(),
      arch: arch(),
      logicalCpus: cpus().length,
      totalMemoryBytes: totalmem(),
      storage: "local APFS PCI-Express SSD (environment.md)",
    },
  };
  await writeFile(output, JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt));
  process.exitCode = summary.passed && unchanged ? 0 : 1;
}

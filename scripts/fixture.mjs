import { mkdir, writeFile, readdir, lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

export const FIXED_NOW = 1790748000000;
export async function createFixture(
  root,
  { count = 40, padded = false, nowMs = FIXED_NOW } = {},
) {
  const home = join(root, "home");
  const profile = join(root, "profile");
  await mkdir(join(home, "sessions"), { recursive: true });
  await mkdir(profile, { recursive: true });
  await writeFile(join(home, "config.json"), "{}");
  await writeFile(
    join(profile, "oracle-tab-leases.json"),
    '{"version":1,"leases":[]}',
  );
  let maximumBytes = 0;
  for (let index = 0; index < count; index++) {
    const id = `synthetic-${String(index).padStart(4, "0")}`;
    const directory = join(home, "sessions", id);
    await mkdir(directory, { recursive: true });
    const doc = {
      id,
      mode: "browser",
      model: "gpt-6-astra",
      status: index % 2 ? "completed" : "running",
      cwd: join(root, "project"),
      startedAt: new Date(nowMs - 120000).toISOString(),
      createdAt: new Date(nowMs - 120000).toISOString(),
      completedAt: new Date(nowMs - 60000).toISOString(),
      browser: { runtime: { promptSubmitted: true } },
      options: {
        slug: `synthetic-${index}-${"長".repeat(index === 0 ? 80 : 1)}${index === 0 ? "e\u0301👨‍👩‍👧‍👦" : ""}`,
        browserConfig: {
          manualLoginProfileDir: profile,
          maxConcurrentTabs: 3,
          thinkingTime: "high",
        },
      },
    };
    let text = JSON.stringify(doc);
    if (padded) {
      doc.syntheticPadding = "x".repeat(
        16384 -
          Buffer.byteLength(JSON.stringify({ ...doc, syntheticPadding: "" })),
      );
      text = JSON.stringify(doc);
    }
    maximumBytes = Math.max(maximumBytes, Buffer.byteLength(text));
    await writeFile(join(directory, "meta.json"), text);
  }
  return { root, home, profile, count, maximumBytes };
}
export function fixtureEnv(fixture) {
  return {
    ...process.env,
    HOME: fixture.root,
    ORACLE_HOME_DIR: fixture.home,
    ORACLE_BROWSER_PROFILE_DIR: fixture.profile,
    ORACLE_BROWSER_MAX_CONCURRENT_TABS: "",
    TERM: "xterm-256color",
  };
}
export async function inventory(root) {
  const rows = [];
  async function walk(path, relative) {
    const stat = await lstat(path, { bigint: true });
    rows.push({
      path: relative,
      mode: String(stat.mode),
      mtimeNs: String(stat.mtimeNs),
      hash: stat.isFile()
        ? createHash("sha256")
            .update(await readFile(path))
            .digest("hex")
        : null,
    });
    if (stat.isDirectory())
      for (const entry of (await readdir(path)).sort())
        await walk(
          join(path, entry),
          relative ? `${relative}/${entry}` : entry,
        );
  }
  await walk(root, "");
  return rows;
}

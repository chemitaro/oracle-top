export function allowedPackFiles(files) {
  return (
    files.length > 0 &&
    files.every(
      (path) =>
        path === "README.md" ||
        path === "package.json" ||
        (/^dist\/[a-z0-9._/-]+$/.test(path) && !path.split("/").includes("..")),
    )
  );
}

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { createFixture, fixtureEnv, inventory } from "./fixture.mjs";
const execute = promisify(execFile);
export async function smokeCli() {
  const root = resolve(".workbench/p10");
  const fixtureRoot = join(root, "installed-fixture");
  const safe = {
    root: fixtureRoot,
    home: join(fixtureRoot, "home"),
    profile: join(fixtureRoot, "profile"),
  };
  const env = fixtureEnv(safe);
  const packDir = join(root, "pack"),
    prefix = join(root, "install"),
    cache = join(root, "cache");
  await mkdir(packDir, { recursive: true });
  await mkdir(prefix, { recursive: true });
  await mkdir(fixtureRoot, { recursive: true });
  const fixture = await createFixture(fixtureRoot, {
    count: 40,
    nowMs: Date.now(),
  });
  for (const [id, content] of [
    ["broken-json", "{"],
    ["broken-encoding", Buffer.from([255])],
  ]) {
    await mkdir(join(fixture.home, "sessions", id), { recursive: true });
    await writeFile(join(fixture.home, "sessions", id, "meta.json"), content);
  }
  const pack = JSON.parse(
    (
      await execute(
        "npm",
        [
          "pack",
          "--json",
          "--ignore-scripts",
          "--cache",
          cache,
          "--pack-destination",
          packDir,
        ],
        { env },
      )
    ).stdout,
  )[0];
  assert.ok(
    allowedPackFiles(pack.files.map((file) => file.path)),
    "pack allowlist",
  );
  const tarball = join(packDir, pack.filename);
  await execute(
    "npm",
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      "--cache",
      cache,
      "--prefix",
      prefix,
      tarball,
    ],
    { env },
  );
  const bin = join(prefix, "node_modules/.bin/oracle-top");
  const manifest = JSON.parse(
    await readFile(
      join(prefix, "node_modules/oracle-top/package.json"),
      "utf8",
    ),
  );
  assert.equal(manifest.type, "module");
  assert.deepEqual(manifest.dependencies, {
    json5: "2.2.3",
    "string-width": "8.3.0",
  });
  assert.equal(manifest.bin["oracle-top"], "dist/cli.js");
  assert.equal(process.versions.node.split(".")[0], "24");
  for (const file of pack.files.filter((file) =>
    file.path.startsWith("dist/"),
  )) {
    assert.deepEqual(
      await readFile(join(prefix, "node_modules/oracle-top", file.path)),
      await readFile(file.path),
      "installed latest build",
    );
  }
  const before = await inventory(fixtureRoot);
  const cases = [];
  async function run(name, args, exit = 0) {
    let result;
    try {
      result = {
        ...(await execute(bin, args, { env, maxBuffer: 4 * 1024 * 1024 })),
        code: 0,
      };
    } catch (error) {
      result = error;
    }
    assert.equal(result.code, exit, name + " exit");
    cases.push({ name, exit: result.code });
    return result;
  }
  const help = await run("help", ["--help"]);
  assert.match(help.stdout, /snapshot/);
  assert.equal(help.stderr, "");
  const version = await run("version", ["--version"]);
  assert.equal(version.stdout, "0.1.0\n");
  const defaultResult = await run("non-tty", [], 2);
  assert.equal(defaultResult.stdout, "");
  assert.match(defaultResult.stderr, /snapshot/);
  const json = await run("json", ["snapshot", "--json"]);
  assert.equal(json.stderr, "");
  assert.ok(json.stdout.endsWith("\n"));
  const snapshot = JSON.parse(json.stdout);
  assert.equal(snapshot.currentSessions.length, 20);
  assert.equal(snapshot.submittedMessages[0].submitted7d, 40);
  assert.deepEqual(snapshot.dataWarnings, [
    {
      code: "INVALID_ENCODING",
      source: "session",
      sessionId: "broken-encoding",
    },
    { code: "INVALID_JSON", source: "session", sessionId: "broken-json" },
  ]);
  const text = await run("text", ["snapshot"]);
  assert.equal(text.stderr, "");
  assert.ok(!text.stdout.includes("\u001b"));
  for (let index = 0; index < 40; index += 2)
    assert.ok(text.stdout.includes(`synthetic-${index}-`), "all current rows");
  assert.match(text.stdout, /Values from readable records only/);
  assert.match(text.stdout, /INVALID_ENCODING/);
  assert.match(text.stdout, /INVALID_JSON/);
  assert.ok(text.stdout.includes("長".repeat(80)), "full slug");
  const pipe = spawn(bin, ["snapshot", "--json"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipe.stdout.destroy();
  let pipeStderr = "";
  pipe.stderr.on("data", (chunk) => (pipeStderr += chunk));
  const pipeExit = await new Promise((resolve, reject) => {
    pipe.on("error", reject);
    pipe.on("close", resolve);
  });
  assert.equal(pipeExit, 0);
  assert.equal(pipeStderr, "");
  cases.push({ name: "closed-pipe", exit: pipeExit });
  assert.deepEqual(
    await inventory(fixtureRoot),
    before,
    "read-only tree/content/mtime/mode",
  );
  const receipt = {
    bin,
    fixture,
    env: {
      HOME: env.HOME,
      ORACLE_HOME_DIR: env.ORACLE_HOME_DIR,
      ORACLE_BROWSER_PROFILE_DIR: env.ORACLE_BROWSER_PROFILE_DIR,
    },
    tarball,
    tarballSha256: createHash("sha256")
      .update(await readFile(tarball))
      .digest("hex"),
    sourceSha256: createHash("sha256")
      .update(
        JSON.stringify(
          (await inventory("src")).map((row) => ({
            path: row.path,
            hash: row.hash,
          })),
        ),
      )
      .digest("hex"),
    distSha256: createHash("sha256")
      .update(
        JSON.stringify(
          (await inventory("dist")).map((row) => ({
            path: row.path,
            hash: row.hash,
          })),
        ),
      )
      .digest("hex"),
    packFiles: pack.files.map((file) => file.path),
    node: process.version,
    runtimeDependencies: manifest.dependencies,
    cases,
    readOnly: true,
  };
  await writeFile(
    join(root, "installed-receipt.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(JSON.stringify(receipt));
  return receipt;
}
if (import.meta.main) await smokeCli();

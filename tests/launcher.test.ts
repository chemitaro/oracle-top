import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const project = fileURLToPath(new URL("../", import.meta.url));

test("launches-from-another-directory-through-a-shell-command-link", () => {
  const root = mkdtempSync(join(tmpdir(), "oracle-top-launcher-"));
  try {
    const bin = join(root, "command bin");
    const cwd = join(root, "caller directory");
    mkdirSync(bin);
    mkdirSync(cwd);
    symlinkSync(join(project, "bin/oracle-top"), join(bin, "oracle-top"));
    const result = spawnSync("oracle-top", ["--version"], {
      cwd,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
      timeout: 10000,
    });
    expect({ status: result.status, stdout: result.stdout?.trim() }).toEqual({
      status: 0,
      stdout: "0.1.0",
    });
    expect(result.stderr).toBe("");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("preserves-caller-directory-and-forwards-snapshot-arguments", () => {
  const root = mkdtempSync(join(tmpdir(), "oracle-top-launcher-"));
  try {
    const bin = join(root, "command bin");
    const links = join(root, "launcher links");
    const cwd = join(root, "caller directory");
    const sessions = join(cwd, "records/sessions/relative-session");
    const profile = join(cwd, "browser");
    for (const path of [bin, links, sessions, profile])
      mkdirSync(path, { recursive: true });
    symlinkSync(join(project, "bin/oracle-top"), join(links, "oracle-top"));
    symlinkSync("../launcher links/oracle-top", join(bin, "oracle-top"));
    writeFileSync(join(cwd, "records/config.json"), "{}");
    writeFileSync(
      join(profile, "oracle-tab-leases.json"),
      '{"version":1,"leases":[]}',
    );
    writeFileSync(
      join(sessions, "meta.json"),
      JSON.stringify({
        id: "relative-session",
        mode: "browser",
        model: "gpt-6-astra",
        status: "running",
        cwd,
        startedAt: new Date().toISOString(),
        options: {
          slug: "caller-data",
          browserConfig: { manualLoginProfileDir: profile },
        },
      }),
    );
    const result = spawnSync("oracle-top", ["snapshot", "--json"], {
      cwd,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        HOME: root,
        ORACLE_HOME_DIR: "./records",
        ORACLE_BROWSER_PROFILE_DIR: "./browser",
        ORACLE_BROWSER_MAX_CONCURRENT_TABS: "",
      },
      encoding: "utf8",
      timeout: 10000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const snapshot = JSON.parse(result.stdout);
    expect(snapshot.currentSessions).toHaveLength(1);
    expect(snapshot.currentSessions[0]).toMatchObject({
      id: "relative-session",
      slug: "caller-data",
    });
    expect(snapshot.browserCapacity.active).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uses-project-runtime-selection-without-changing-caller-directory", () => {
  const root = mkdtempSync(join(tmpdir(), "oracle-top-launcher-"));
  try {
    const bin = join(root, "command bin");
    const cwd = join(root, "caller directory");
    mkdirSync(bin);
    mkdirSync(cwd);
    writeFileSync(join(cwd, ".node-version"), "nonexistent-oracle-top-node\n");
    symlinkSync(join(project, "bin/oracle-top"), join(bin, "oracle-top"));
    const selector = spawnSync("nodenv", ["root"], { encoding: "utf8" });
    const runtimePath =
      selector.status === 0
        ? `${join(selector.stdout.trim(), "shims")}:${process.env.PATH}`
        : process.env.PATH;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${bin}:${runtimePath}`,
    };
    delete env.NODENV_DIR;
    delete env.NODENV_VERSION;
    const result = spawnSync("oracle-top", ["--version"], {
      cwd,
      env,
      encoding: "utf8",
      timeout: 10000,
    });
    expect({ status: result.status, stdout: result.stdout?.trim() }).toEqual({
      status: 0,
      stdout: "0.1.0",
    });
    expect(result.stderr).toBe("");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uses-project-runtime-when-caller-node-is-unavailable", () => {
  const root = mkdtempSync(join(tmpdir(), "oracle-top-launcher-"));
  try {
    const bin = join(root, "command bin");
    const cwd = join(root, "caller directory");
    mkdirSync(bin);
    mkdirSync(cwd);
    symlinkSync(join(project, "bin/oracle-top"), join(bin, "oracle-top"));
    writeFileSync(
      join(bin, "node"),
      "#!/bin/sh\nprintf '%s\\n' 'Caller node is unavailable' >&2\nexit 44\n",
      { mode: 0o755 },
    );
    const selected = `'${process.execPath.replace(/'/g, "'\\''")}'`;
    writeFileSync(
      join(bin, "nodenv"),
      `#!/bin/sh\nif [ "$1" = which ] && [ "$2" = node ]; then\n  printf '%s\\n' ${selected}\nelse\n  exit 45\nfi\n`,
      { mode: 0o755 },
    );
    const result = spawnSync("oracle-top", ["--version"], {
      cwd,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
      timeout: 10000,
    });
    expect({ status: result.status, stdout: result.stdout?.trim() }).toEqual({
      status: 0,
      stdout: "0.1.0",
    });
    expect(result.stderr).toBe("");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

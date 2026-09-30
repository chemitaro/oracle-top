import { constants } from "node:fs";
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  nodeReadOnlyFileSystem,
  readJsonFile,
  type JsonReadRequest,
  type ReadOnlyHandle,
} from "../src/io/json-reader.js";

let root: string;

beforeEach(async () => {
  await mkdir(join(process.cwd(), ".workbench", "p03"), { recursive: true });
  root = await mkdtemp(join(process.cwd(), ".workbench/p03/fixture-"));
  await mkdir(join(root, "sessions", "sample"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function read(
  format: "json" | "json5" = "json",
  overrides: Partial<JsonReadRequest> = {},
) {
  return readJsonFile({
    rootPath: root,
    pathSegments: ["sessions", "sample", "meta.json"],
    format,
    context: { source: "session", sessionId: "sample" },
    ...overrides,
  });
}

test("reads-json", async () => {
  await writeFile(
    join(root, "sessions", "sample", "meta.json"),
    '{"model":"gpt-example"}',
  );
  expect(await read()).toEqual({
    kind: "value",
    value: { model: "gpt-example" },
  });
});

test("reads-json5", async () => {
  await writeFile(
    join(root, "sessions", "sample", "meta.json"),
    "{/* saved config */ maximum: 3,}",
  );
  expect(await read("json5")).toEqual({ kind: "value", value: { maximum: 3 } });
});

test("isolates-invalid-json", async () => {
  await writeFile(join(root, "sessions", "sample", "meta.json"), "{broken}");
  expect(await read()).toEqual({
    kind: "warning",
    warning: { code: "INVALID_JSON", source: "session", sessionId: "sample" },
  });
});

test("isolates-invalid-json5", async () => {
  await writeFile(join(root, "sessions", "sample", "meta.json"), "{broken}");
  expect(await read("json5")).toEqual({
    kind: "warning",
    warning: { code: "INVALID_JSON5", source: "session", sessionId: "sample" },
  });
});

test("rejects-non-object-root", async () => {
  for (const content of ["[]", "null", "42"]) {
    await writeFile(join(root, "sessions", "sample", "meta.json"), content);
    expect(await read()).toEqual({
      kind: "warning",
      warning: { code: "INVALID_ROOT", source: "session", sessionId: "sample" },
    });
  }
});

test("rejects-over-limit-file", async () => {
  await writeFile(
    join(root, "sessions", "sample", "meta.json"),
    "{}".padEnd(1_048_577, " "),
  );
  expect(await read()).toEqual({
    kind: "warning",
    warning: { code: "FILE_TOO_LARGE", source: "session", sessionId: "sample" },
  });
});

test("accepts-exact-limit-file", async () => {
  await writeFile(
    join(root, "sessions", "sample", "meta.json"),
    "{}".padEnd(1_048_576, " "),
  );
  expect(await read()).toEqual({ kind: "value", value: {} });
});

test("rejects-invalid-encoding", async () => {
  await writeFile(
    join(root, "sessions", "sample", "meta.json"),
    Buffer.concat([
      Buffer.from('{"bad":"'),
      Buffer.from([0xff]),
      Buffer.from('"}'),
    ]),
  );
  expect(await read()).toEqual({
    kind: "warning",
    warning: {
      code: "INVALID_ENCODING",
      source: "session",
      sessionId: "sample",
    },
  });
});

test("rejects-non-regular-file", async () => {
  await mkdir(join(root, "sessions", "sample", "meta.json"));
  expect(await read()).toEqual({
    kind: "warning",
    warning: {
      code: "FILE_NOT_REGULAR",
      source: "session",
      sessionId: "sample",
    },
  });
});

test("skips-file-symlink-without-opening-target", async () => {
  const target = join(root, "target.json");
  await writeFile(target, "{}");
  await symlink(target, join(root, "sessions", "sample", "meta.json"));
  let opened = false;
  const result = await read("json", {
    io: {
      ...nodeReadOnlyFileSystem,
      async open(path, flags) {
        opened = true;
        return nodeReadOnlyFileSystem.open(path, flags);
      },
    },
  });
  expect(result).toEqual({
    kind: "warning",
    warning: {
      code: "SYMLINK_SKIPPED",
      source: "session",
      sessionId: "sample",
    },
  });
  expect(opened).toBe(false);
});

test("skips-descendant-directory-symlink", async () => {
  await writeFile(join(root, "sessions", "sample", "meta.json"), "{}");
  await symlink(join(root, "sessions"), join(root, "linked-sessions"));
  expect(
    await read("json", {
      pathSegments: ["linked-sessions", "sample", "meta.json"],
    }),
  ).toEqual({
    kind: "warning",
    warning: {
      code: "SYMLINK_SKIPPED",
      source: "session",
      sessionId: "sample",
    },
  });
});

test("allows-configured-root-symlink", async () => {
  await writeFile(join(root, "sessions", "sample", "meta.json"), "{}");
  await symlink(root, join(root, "root-link"));
  expect(await read("json", { rootPath: join(root, "root-link") })).toEqual({
    kind: "value",
    value: {},
  });
});

test("isolates-missing-file", async () => {
  expect(await read()).toEqual({
    kind: "warning",
    warning: { code: "FILE_MISSING", source: "session", sessionId: "sample" },
  });
});

test("isolates-file-replacement-during-read", async () => {
  const file = join(root, "sessions", "sample", "meta.json");
  await writeFile(file, '{"saved":1}');
  let replaced = false;
  const result = await read("json", {
    io: {
      ...nodeReadOnlyFileSystem,
      async open(path, flags) {
        const handle = await nodeReadOnlyFileSystem.open(path, flags);
        return {
          ...handle,
          async read(...args) {
            const data = await handle.read(...args);
            if (!replaced) {
              replaced = true;
              await writeFile(join(root, "replacement.json"), '{"saved":2}');
              await rename(join(root, "replacement.json"), file);
            }
            return data;
          },
        };
      },
    },
  });
  expect(result).toEqual({
    kind: "warning",
    warning: { code: "FILE_CHANGED", source: "session", sessionId: "sample" },
  });
  expect(await read()).toEqual({ kind: "value", value: { saved: 2 } });
});

test("isolates-parent-directory-replacement", async () => {
  const directory = join(root, "sessions", "sample");
  await writeFile(join(directory, "meta.json"), "{}");
  let replaced = false;
  const result = await read("json", {
    io: {
      ...nodeReadOnlyFileSystem,
      async open(path, flags) {
        const handle = await nodeReadOnlyFileSystem.open(path, flags);
        return {
          ...handle,
          async read(...args) {
            const data = await handle.read(...args);
            if (!replaced) {
              replaced = true;
              await rename(directory, join(root, "old-directory"));
              await mkdir(directory);
              await rename(
                join(root, "old-directory", "meta.json"),
                join(directory, "meta.json"),
              );
            }
            return data;
          },
        };
      },
    },
  });
  expect(result).toEqual({
    kind: "warning",
    warning: { code: "FILE_CHANGED", source: "session", sessionId: "sample" },
  });
});

test("isolates-parent-swapped-to-symlink", async () => {
  const directory = join(root, "sessions", "sample");
  await writeFile(join(directory, "meta.json"), "{}");
  let replaced = false;
  const result = await read("json", {
    io: {
      ...nodeReadOnlyFileSystem,
      async open(path, flags) {
        const handle = await nodeReadOnlyFileSystem.open(path, flags);
        return {
          ...handle,
          async read(...args) {
            const data = await handle.read(...args);
            if (!replaced) {
              replaced = true;
              await rename(directory, join(root, "old-directory"));
              await symlink(join(root, "old-directory"), directory);
            }
            return data;
          },
        };
      },
    },
  });
  expect(result).toEqual({
    kind: "warning",
    warning: { code: "FILE_CHANGED", source: "session", sessionId: "sample" },
  });
});

test("aborts-before-opening", async () => {
  const controller = new AbortController();
  controller.abort();
  expect(await read("json", { signal: controller.signal })).toEqual({
    kind: "aborted",
  });
});

test("aborts-during-read-and-closes-handle", async () => {
  await writeFile(join(root, "sessions", "sample", "meta.json"), "{}");
  const controller = new AbortController();
  let captured: ReadOnlyHandle | undefined;
  const result = await read("json", {
    signal: controller.signal,
    io: {
      ...nodeReadOnlyFileSystem,
      async open(path, flags) {
        const handle = await nodeReadOnlyFileSystem.open(path, flags);
        captured = handle;
        return {
          ...handle,
          async read(...args) {
            const data = await handle.read(...args);
            controller.abort();
            return data;
          },
        };
      },
    },
  });
  expect(result).toEqual({ kind: "aborted" });
  await expect(captured!.stat()).rejects.toMatchObject({ code: "EBADF" });
});

test("rejects-path-escape", async () => {
  await writeFile(join(root, "target.json"), "{}");
  expect(
    await read("json", { pathSegments: ["sessions", "..", "target.json"] }),
  ).toEqual({
    kind: "warning",
    warning: { code: "INVALID_FIELD", source: "session", sessionId: "sample" },
  });
});

test("returns-safe-warning-for-io-failure", async () => {
  await writeFile(join(root, "sessions", "sample", "meta.json"), "{}");
  const result = await read("json", {
    io: {
      ...nodeReadOnlyFileSystem,
      async open() {
        throw Object.assign(new Error("secret prompt /private/location"), {
          code: "EACCES",
        });
      },
    },
  });
  expect(result).toEqual({
    kind: "warning",
    warning: {
      code: "FILE_UNREADABLE",
      source: "session",
      sessionId: "sample",
    },
  });
  expect(await read()).toEqual({ kind: "value", value: {} });
});

test("rejects-final-symlink-race-with-no-follow", async () => {
  const file = join(root, "sessions", "sample", "meta.json");
  await writeFile(file, "{}");
  await writeFile(join(root, "target.json"), '{"target":true}');
  let usedFlags: number | undefined;
  const result = await read("json", {
    io: {
      ...nodeReadOnlyFileSystem,
      async open(path, flags) {
        usedFlags = flags;
        await rm(file);
        await symlink(join(root, "target.json"), file);
        return nodeReadOnlyFileSystem.open(path, flags);
      },
    },
  });
  expect(result).toEqual({
    kind: "warning",
    warning: { code: "FILE_CHANGED", source: "session", sessionId: "sample" },
  });
  expect(usedFlags).toBe(
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
});

test("aborts-during-close-before-return", async () => {
  await writeFile(join(root, "sessions", "sample", "meta.json"), "{}");
  const controller = new AbortController();
  const result = await read("json", {
    signal: controller.signal,
    io: {
      ...nodeReadOnlyFileSystem,
      async open(path, flags) {
        const handle = await nodeReadOnlyFileSystem.open(path, flags);
        return {
          ...handle,
          async close() {
            await handle.close();
            controller.abort();
          },
        };
      },
    },
  });
  expect(result).toEqual({ kind: "aborted" });
});

test("bounds-read-when-file-grows", async () => {
  const file = join(root, "sessions", "sample", "meta.json");
  await writeFile(file, "{}");
  let readBytes = 0;
  const result = await read("json", {
    io: {
      ...nodeReadOnlyFileSystem,
      async open(path, flags) {
        const handle = await nodeReadOnlyFileSystem.open(path, flags);
        return {
          ...handle,
          async stat() {
            const value = await handle.stat();
            await writeFile(file, "{}".padEnd(1_048_580, " "));
            return value;
          },
          async read(...args) {
            const data = await handle.read(...args);
            readBytes += data.bytesRead;
            return data;
          },
        };
      },
    },
  });
  expect(result).toEqual({
    kind: "warning",
    warning: { code: "FILE_TOO_LARGE", source: "session", sessionId: "sample" },
  });
  expect(readBytes).toBe(1_048_577);
});

test("handles-short-reads-until-eof", async () => {
  await writeFile(
    join(root, "sessions", "sample", "meta.json"),
    '{"model":"example"}',
  );
  const result = await read("json", {
    io: {
      ...nodeReadOnlyFileSystem,
      async open(path, flags) {
        const handle = await nodeReadOnlyFileSystem.open(path, flags);
        return {
          ...handle,
          read: (buffer, offset, length, position) =>
            handle.read(buffer, offset, Math.min(length, 3), position),
        };
      },
    },
  });
  expect(result).toEqual({ kind: "value", value: { model: "example" } });
});

test("isolates-file-disappearance-during-read", async () => {
  const file = join(root, "sessions", "sample", "meta.json");
  await writeFile(file, "{}");
  const result = await read("json", {
    io: {
      ...nodeReadOnlyFileSystem,
      async open(path, flags) {
        const handle = await nodeReadOnlyFileSystem.open(path, flags);
        return {
          ...handle,
          async read(...args) {
            const data = await handle.read(...args);
            await rm(file, { force: true });
            return data;
          },
        };
      },
    },
  });
  expect(result).toEqual({
    kind: "warning",
    warning: { code: "FILE_CHANGED", source: "session", sessionId: "sample" },
  });
});

test("isolates-in-place-file-change", async () => {
  const file = join(root, "sessions", "sample", "meta.json");
  await writeFile(file, '{"saved":1}');
  let changed = false;
  const result = await read("json", {
    io: {
      ...nodeReadOnlyFileSystem,
      async open(path, flags) {
        const handle = await nodeReadOnlyFileSystem.open(path, flags);
        return {
          ...handle,
          async read(...args) {
            const data = await handle.read(...args);
            if (!changed) {
              changed = true;
              await writeFile(file, '{"saved":2}');
            }
            return data;
          },
        };
      },
    },
  });
  expect(result).toEqual({
    kind: "warning",
    warning: { code: "FILE_CHANGED", source: "session", sessionId: "sample" },
  });
});

test("closes-handle-on-read-failure", async () => {
  await writeFile(join(root, "sessions", "sample", "meta.json"), "{}");
  let captured: ReadOnlyHandle | undefined;
  const result = await read("json", {
    io: {
      ...nodeReadOnlyFileSystem,
      async open(path, flags) {
        const handle = await nodeReadOnlyFileSystem.open(path, flags);
        captured = handle;
        return {
          ...handle,
          async read() {
            throw Object.assign(new Error("private read failure"), {
              code: "EIO",
            });
          },
        };
      },
    },
  });
  expect(result).toEqual({
    kind: "warning",
    warning: {
      code: "FILE_UNREADABLE",
      source: "session",
      sessionId: "sample",
    },
  });
  await expect(captured!.stat()).rejects.toMatchObject({ code: "EBADF" });
});

test("closes-handle-for-rejected-document", async () => {
  for (const content of [
    "{}".padEnd(1_048_577, " "),
    "{broken}",
    "null",
    Buffer.from([0xff]),
  ]) {
    await writeFile(join(root, "sessions", "sample", "meta.json"), content);
    let captured: ReadOnlyHandle | undefined;
    const result = await read("json", {
      io: {
        ...nodeReadOnlyFileSystem,
        async open(path, flags) {
          captured = await nodeReadOnlyFileSystem.open(path, flags);
          return captured;
        },
      },
    });
    expect(result.kind).toBe("warning");
    await expect(captured!.stat()).rejects.toMatchObject({ code: "EBADF" });
  }
});

test("isolates-close-failure", async () => {
  await writeFile(join(root, "sessions", "sample", "meta.json"), "{}");
  const result = await read("json", {
    io: {
      ...nodeReadOnlyFileSystem,
      async open(path, flags) {
        const handle = await nodeReadOnlyFileSystem.open(path, flags);
        return {
          ...handle,
          async close() {
            await handle.close();
            throw new Error("private close failure");
          },
        };
      },
    },
  });
  expect(result).toEqual({
    kind: "warning",
    warning: {
      code: "FILE_UNREADABLE",
      source: "session",
      sessionId: "sample",
    },
  });
});

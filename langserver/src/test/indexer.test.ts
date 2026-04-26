import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// Mock child_process.spawn before importing indexer.
const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }));

import { reindex } from "../server/indexer";
import type { FileConfig } from "../workspace/config";

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill(): boolean {
    this.killed = true;
    return true;
  }
}

const FILE_CONFIG: FileConfig = {
  mainFile: "/project/game.inf",
  compiler: "/usr/local/bin/inform6",
  libraryPath: "",
  switches: "",
  defines: [],
  externalDefines: [],
  warnUndeclaredProperties: false,
};

const noopLog = () => undefined;

function validJson(): string {
  return JSON.stringify({
    version: 1,
    files: ["/project/game.inf"],
    symbols: [],
    routines: [
      { name: "Main", file: "/project/game.inf", start_line: 1, end_line: 5, locals: [] },
      // Veneer routine: no `file` — should be filtered out.
      { name: "RT__Err", start_line: 0, end_line: 0, locals: [] },
    ],
    objects: [],
    globals: [],
    constants: [],
    arrays: [],
    verbs: [],
    dictionary: [],
    errors: [],
  });
}

describe("reindex", () => {
  beforeEach(() => spawnMock.mockReset());

  it("returns null when spawn emits an error (e.g. ENOENT)", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    const promise = reindex(FILE_CONFIG, "/project", noopLog);
    queueMicrotask(() => child.emit("error", new Error("ENOENT")));

    expect(await promise).toBeNull();
  });

  it("parses valid JSON and resolves the index", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    const promise = reindex(FILE_CONFIG, "/project", noopLog);
    queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from(validJson()));
      child.emit("close", 0, null);
    });

    const idx = await promise;
    expect(idx).not.toBeNull();
    expect(idx!.routines.map((r) => r.name)).toContain("Main");
  });

  it("filters out veneer routines (those without a file field)", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    const promise = reindex(FILE_CONFIG, "/project", noopLog);
    queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from(validJson()));
      child.emit("close", 0, null);
    });

    const idx = await promise;
    expect(idx!.routines.map((r) => r.name)).not.toContain("RT__Err");
    expect(idx!.routines).toHaveLength(1);
  });

  it("returns null when stdout is empty", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    const promise = reindex(FILE_CONFIG, "/project", noopLog);
    queueMicrotask(() => child.emit("close", 0, null));

    expect(await promise).toBeNull();
  });

  it("returns null when stdout is not valid JSON", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    const promise = reindex(FILE_CONFIG, "/project", noopLog);
    queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from("this is not json"));
      child.emit("close", 0, null);
    });

    expect(await promise).toBeNull();
  });

  it("returns null and kills the child when it does not finish within 10 s", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    const promise = reindex(FILE_CONFIG, "/project", noopLog);

    vi.advanceTimersByTime(10_001);

    expect(child.killed).toBe(true);

    // The close handler ignores the post-kill close (signal branch).  Resolve
    // by not emitting close — the timeout already resolved the promise.
    const result = await promise;
    expect(result).toBeNull();
    vi.useRealTimers();
  });

  it("returns null and kills the child when stdout exceeds the size cap", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    const promise = reindex(FILE_CONFIG, "/project", noopLog);

    // Emit one giant chunk well over MAX_STDOUT_BYTES (50 MiB).  Use a
    // single allocation rather than a loop to keep the test fast.
    queueMicrotask(() => {
      const huge = Buffer.alloc(60 * 1024 * 1024, 0x41); // 60 MiB of 'A'
      child.stdout.emit("data", huge);
      // The overflow handler kills the child; close will fire with a signal
      // and the existing handler's `if (signal) return;` swallows it.  No
      // need to emit close ourselves.
    });

    expect(await promise).toBeNull();
    expect(child.killed).toBe(true);
  });

  it("invokes spawn with -y plus library, switches, and define args", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    const fc: FileConfig = {
      ...FILE_CONFIG,
      libraryPath: "/lib/inform6",
      switches: "-v5 -G",
      defines: ["DEBUG", "FOO=2"],
    };
    const promise = reindex(fc, "/project", noopLog);
    queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from(validJson()));
      child.emit("close", 0, null);
    });
    await promise;

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawnMock.mock.calls[0];
    expect(cmd).toBe(fc.compiler);
    expect(args).toEqual(["-y", "-v5", "-G", "+/lib/inform6", "--define", "DEBUG=1", "--define", "FOO=2", fc.mainFile]);
  });
});

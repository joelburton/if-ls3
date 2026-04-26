import { describe, it, expect } from "vitest";
import { isVerboseOnly } from "../../client/outputFilter";

describe("isVerboseOnly", () => {
  // ── verbose-only (suppressed in quiet mode) ──────────────────────────────

  it("suppresses [activate] server: lines", () => {
    expect(isVerboseOnly("[activate] server: /path/to/server.cjs")).toBe(true);
  });

  it("suppresses [server] exited lines", () => {
    expect(isVerboseOnly("[server] exited code=0 signal=null")).toBe(true);
  });

  it("suppresses [stderr] lines (compiler output during indexing)", () => {
    expect(isVerboseOnly("[stderr] line 5: Warning: unused")).toBe(true);
  });

  it("suppresses [extension] TextMate lines", () => {
    expect(isVerboseOnly("[extension] TextMate highlighting: on (inform6.tmLanguage.json → ...)")).toBe(true);
  });

  it("suppresses [extension] inform6.enable lines", () => {
    expect(isVerboseOnly("[extension] inform6.enableLanguageServer changed — restarting client")).toBe(true);
  });

  it("suppresses [indexer] spawning lines", () => {
    expect(isVerboseOnly("[indexer] spawning #1 (tiny.inf): /usr/bin/inform6 -y ...")).toBe(true);
  });

  it("suppresses [indexer] OK lines", () => {
    expect(isVerboseOnly("[indexer] OK (tiny.inf): 3 routines, 2 objects")).toBe(true);
  });

  it("suppresses [indexer] stdout: lines", () => {
    expect(isVerboseOnly("[indexer] stdout: 4096 bytes (tiny.inf)")).toBe(true);
  });

  it("suppresses [indexer] stderr: lines", () => {
    expect(isVerboseOnly("[indexer] stderr: line 5: Warning: ...")).toBe(true);
  });

  // ── always shown ─────────────────────────────────────────────────────────

  it("passes [server] spawn error through", () => {
    expect(isVerboseOnly("[server] spawn error: ENOENT")).toBe(false);
  });

  it("passes [server] no inform6rc.yaml through", () => {
    expect(isVerboseOnly("[server] no inform6rc.yaml found — language server features disabled")).toBe(false);
  });

  it("passes [server] config: through", () => {
    expect(isVerboseOnly("[server] config: 1 main file(s): tiny.inf")).toBe(false);
  });

  it("passes [indexer] FAILED through", () => {
    expect(isVerboseOnly("[indexer] FAILED (tiny.inf): no JSON on stdout")).toBe(false);
  });

  it("passes [indexer] TIMEOUT through", () => {
    expect(isVerboseOnly("[indexer] TIMEOUT (tiny.inf): compiler did not finish")).toBe(false);
  });

  it("passes [activate] language server disabled through", () => {
    expect(isVerboseOnly("[activate] language server disabled by configuration")).toBe(false);
  });

  it("passes [extension] warning through", () => {
    expect(isVerboseOnly("[extension] warning: could not write grammar file")).toBe(false);
  });

  it("passes [compile] lines through", () => {
    expect(isVerboseOnly("[compile] tiny.inf")).toBe(false);
  });

  it("passes arbitrary text through", () => {
    expect(isVerboseOnly("some unexpected message")).toBe(false);
  });
});

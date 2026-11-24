import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { RuntimeContext } from "../src/runtime/runtime.ts";
import { createCompactionOperations } from "../src/runtime/runtime-parts/runtime-compaction.ts";
import { sessionPaths } from "../src/runtime/runtime-parts/runtime-shared.ts";

vi.mock("../src/runtime/runtime-parts/runtime-shared.ts", () => ({ sessionPaths: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, stat: vi.fn(actual.stat) };
});

it.each([0, 1])("cancels only caller %i while sharing one context estimate", async (cancelled) => {
  vi.clearAllMocks();
  const dir = await mkdtemp(join(tmpdir(), "pibot-context-estimate-"));
  const file = join(dir, "session.jsonl");
  const ready = Promise.withResolvers<Awaited<ReturnType<RuntimeContext["buildRuntime"]>>>();
  const open = vi.fn(() => ({ getBranch: () => [] }));
  const buildRuntime = vi.fn(() => ready.promise);
  const runtime = {
    pi: { SessionManager: { open }, buildSessionProjection: () => ({ messages: [] }) },
  };
  const controllers = [new AbortController(), new AbortController()];
  const reason = new Error("caller cancelled");
  const settled = [vi.fn(), vi.fn()];

  try {
    await writeFile(file, "{}\n");
    vi.mocked(sessionPaths).mockResolvedValue(file);
    const estimate = createCompactionOperations({
      dataDir: dir,
      buildRuntime,
    } as unknown as RuntimeContext).estimateContext;
    const start = (index: number) =>
      estimate?.({
        botId: "bot",
        sessionFile: file,
        signal: controllers[index].signal,
      }).catch(settled[index]);

    const first = start(0);
    await vi.waitFor(() => expect(buildRuntime).toHaveBeenCalledOnce());
    const second = start(1);
    await vi.waitFor(() => expect(stat).toHaveBeenCalledTimes(2));
    await Promise.all(vi.mocked(stat).mock.results.map((result) => result.value));
    controllers[cancelled].abort(reason);
    await vi.waitFor(() => expect(settled[cancelled]).toHaveBeenCalledWith(reason));

    ready.resolve(runtime as unknown as Awaited<ReturnType<RuntimeContext["buildRuntime"]>>);
    const results = await Promise.all([first, second]);
    expect(results[1 - cancelled]).toEqual({ tokens: 0, model: undefined });
    expect(settled[1 - cancelled]).not.toHaveBeenCalled();
    expect(buildRuntime).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
  } finally {
    ready.resolve(runtime as unknown as Awaited<ReturnType<RuntimeContext["buildRuntime"]>>);
    await rm(dir, { recursive: true, force: true });
  }
});

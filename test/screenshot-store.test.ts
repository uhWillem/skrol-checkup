import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ScreenshotStore } from "../src/screenshot-store.js";

test("screenshots bewaren, teruglezen en na de termijn opruimen", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shots-"));
  const store = new ScreenshotStore(dir, 30);
  const id = await store.save(Buffer.from("beeld"));
  assert.match(id, /^[A-Za-z0-9_-]{24}$/);
  assert.equal((await store.read(id))?.toString(), "beeld");
  assert.equal(await store.read("../../etc/passwd"), undefined);
  assert.equal(ScreenshotStore.idFromPath(`/screenshots/${id}.jpg`), id);
  assert.equal(ScreenshotStore.idFromPath(`/screenshots/${id}.png`), undefined);
  assert.equal(ScreenshotStore.idFromPath("/screenshots/../jobs.jpg"), undefined);

  const old = await store.save(Buffer.from("oud"));
  const longAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  await utimes(join(dir, `${old}.jpg`), longAgo, longAgo);
  assert.equal(await store.prune(), 1);
  assert.equal(await store.read(old), undefined);
  assert.ok(await store.read(id));
});

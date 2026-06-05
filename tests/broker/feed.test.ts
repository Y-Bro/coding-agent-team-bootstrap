import { test } from "node:test";
import assert from "node:assert/strict";
import { FeedRenderer } from "../../src/broker/feed.ts";
import { MemoryFs } from "../ports/fakes.ts";
import type { Message } from "../../src/a2a/index.ts";

test("renders a markdown line per message to feed.md", () => {
  const fs = new MemoryFs();
  const feed = new FeedRenderer(fs, ".team/feed.md");
  const m: Message = { id: "m1", from: "fe-writer", to: "fe-reviewer", type: "review_request",
    parts: [{ kind: "text", text: "slice 4" }], ts: "2026-06-06T00:00:00.000Z" };
  feed.append(m);
  const out = fs.read(".team/feed.md");
  assert.match(out, /fe-writer → fe-reviewer/);
  assert.match(out, /review_request/);
  assert.match(out, /slice 4/);
});

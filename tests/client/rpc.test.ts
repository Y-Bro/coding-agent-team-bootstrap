import { test } from "node:test";
import assert from "node:assert/strict";
import { BrokerClient } from "../../src/client/rpc.ts";
import type { SocketClient } from "../../src/ports/transport.ts";

class FakeClient implements SocketClient {
  constructor(private responder: (msg: any) => unknown) {}
  async request(_path: string, msg: unknown): Promise<unknown> { return this.responder(msg); }
}

test("send returns the created message", async () => {
  const transport = new FakeClient((msg) => {
    assert.equal(msg.method, "message/send");
    return { ok: true, result: { id: "m1" } };
  });
  const client = new BrokerClient(transport, ".team/broker.sock");
  const m = await client.send({ from: "a", to: "b", type: "note", parts: [{ kind: "text", text: "hi" }] });
  assert.equal((m as any).id, "m1");
});

test("a broker error throws with the message", async () => {
  const transport = new FakeClient(() => ({ ok: false, error: "unknown target: zzz" }));
  const client = new BrokerClient(transport, ".team/broker.sock");
  await assert.rejects(() => client.peek("a"), /unknown target/);
});

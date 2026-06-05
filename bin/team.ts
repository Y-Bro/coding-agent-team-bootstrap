#!/usr/bin/env -S node --import tsx
import { NodeSocketClient } from "../src/ports/transport.ts";
import { BrokerClient } from "../src/client/rpc.ts";
import { buildProgram } from "../src/client/cli.ts";

const agentId = process.env.TEAM_AGENT_ID ?? "operator";
const socket = process.env.TEAM_SOCKET ?? ".team/broker.sock";
const client = new BrokerClient(new NodeSocketClient(), socket);
const program = buildProgram(client as any, agentId, (s) => console.log(s));

program.parseAsync(process.argv).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

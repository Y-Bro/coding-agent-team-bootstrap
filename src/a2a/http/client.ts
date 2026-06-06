import type { AgentCard, Message } from "../index.ts";
import type { HttpClient } from "../../ports/http.ts";
import {
  A2A_PATHS, A2A_METHOD_MESSAGE_SEND,
  type JsonRpcRequest, type JsonRpcResponse, type MessageSendParams, type MessageSendResult,
} from "./types.ts";

/**
 * Client for one remote agent's A2A-over-HTTP endpoint: fetch its AgentCard and
 * call `message/send`. Transport is the injected HttpClient; `baseUrl` is the
 * remote agent's origin (e.g. http://host:port).
 */
export class A2AClient {
  constructor(private http: HttpClient, private baseUrl: string) {}

  async fetchAgentCard(): Promise<AgentCard> {
    const res = await this.http.request(this.baseUrl + A2A_PATHS.agentCard, { method: "GET" });
    if (res.status !== 200) throw new Error(`agent card fetch failed (${res.status})`);
    return JSON.parse(res.body) as AgentCard;
  }

  async sendMessage(message: Message): Promise<Message> {
    const req: JsonRpcRequest<MessageSendParams> = {
      jsonrpc: "2.0", id: 1, method: A2A_METHOD_MESSAGE_SEND, params: { message },
    };
    const res = await this.http.request(this.baseUrl + A2A_PATHS.rpc, {
      method: "POST", body: JSON.stringify(req),
    });
    const rpc = JSON.parse(res.body) as JsonRpcResponse<MessageSendResult>;
    if ("error" in rpc) throw new Error(rpc.error.message);
    return rpc.result.message;
  }
}

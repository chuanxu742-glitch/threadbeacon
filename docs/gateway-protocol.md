# ThreadBeacon Agent Gateway protocol v1

The Gateway is a standalone Node process. Agents establish outbound WebSocket connections; the control plane only calls the Gateway over protected HTTPS and never depends on raw TCP or process-local WebSocket state.

## Endpoints

- `GET /healthz`: unauthenticated liveness probe returning only state and protocol version.
- `GET /health`: detailed Gateway/Agent health. Requires the control Bearer token.
- `GET /capabilities`: connected agents, capacity, and the union of capabilities. Requires the control Bearer token.
- `POST /dispatch`: synchronous compatibility dispatch, or asynchronous control-plane dispatch with `{ "mode": "async", "job": Job }`. Requires the control Bearer token.
- `GET /agent`: WebSocket upgrade endpoint. Requires the Agent Bearer token.

Run locally with `pnpm gateway`. The default listen address is `127.0.0.1:8789`. Public deployments must terminate TLS at a reverse proxy and expose `/agent` as `wss://` and the control endpoints as `https://`.

Gateway environment variables:

- `THREADBEACON_GATEWAY_LISTEN=0.0.0.0:8789`
- `THREADBEACON_GATEWAY_AGENT_TOKEN` (or `THREADBEACON_GATEWAY_SHARED_SECRET` compatibility alias)
- `THREADBEACON_GATEWAY_CONTROL_TOKEN` (must differ from the Agent token)
- `THREADBEACON_GATEWAY_ID`
- `THREADBEACON_GATEWAY_DISPATCH_TIMEOUT_MS` (default 15000)

To make the Gateway a dispatchable control-plane node, also configure:

- `THREADBEACON_CONTROL_URL`
- `THREADBEACON_NODE_REGISTRATION_KEY` for the first registration
- `THREADBEACON_GATEWAY_PUBLIC_URL=https://gateway.example.com` (the control plane calls its `/dispatch` endpoint)
- `THREADBEACON_GATEWAY_NODE_NAME` (falls back to `THREADBEACON_GATEWAY_ID`, then the host name)
- `THREADBEACON_GATEWAY_STATE_FILE=/data/gateway-state.json` to atomically persist the issued node ID/token
- `THREADBEACON_GATEWAY_NODE_ID` and `THREADBEACON_GATEWAY_NODE_TOKEN` for explicit credentials; explicit values take precedence over the state file
- `THREADBEACON_GATEWAY_HEARTBEAT_MS` (default 20000)

`THREADBEACON_WORKER_STATE_FILE` and the generic `THREADBEACON_NODE_ID`/`THREADBEACON_NODE_TOKEN` are accepted as compatibility fallbacks. The Gateway registers once as `transport=gateway-ws`; subsequent authenticated heartbeats refresh the union of connected Agent capabilities, total capacity (bounded to 64), active jobs, and the advertised HTTPS endpoint. The control Bearer token is encrypted by the control plane and is never sent to reverse Agents.

Worker reverse-Agent variables:

- `THREADBEACON_GATEWAY_WS_URL=wss://gateway.example.com/agent`
- `THREADBEACON_GATEWAY_TOKEN`
- `THREADBEACON_GATEWAY_AGENT_ID`
- `THREADBEACON_GATEWAY_ALLOW_INSECURE_WS=1` only for protected internal networks (for example Compose/NetworkPolicy); default remains WSS-only off loopback.
- `THREADBEACON_WORKER_CONCURRENCY`

When Gateway mode is configured, the Worker does not poll for data jobs. If the same Worker also has `THREADBEACON_CONTROL_URL` and `OPENCLI_CDP_ENDPOINT`, it keeps a separate browser-action-only polling loop plus its normal authenticated heartbeat; its control-plane data capabilities are cleared so WebSocket and polling cannot claim the same collection job. Without CDP it runs only the reverse data Agent and control heartbeat. Polling and Direct HTTP remain available when their respective variables are used.

## WebSocket messages

The Agent sends `register` immediately after connection:

```json
{"type":"register","protocolVersion":1,"agentId":"worker-01","capabilities":["reddit","rss"],"maxConcurrency":4}
```

The Gateway replies with `registered`. Jobs use a two-stage delivery:

1. Gateway sends `{"type":"job","job":{...}}`.
2. Agent sends `{"type":"ack","jobId":"..."}` within three seconds. For `mode=async`, Gateway now returns HTTP 202 immediately; the control-plane job remains `running`.
3. Agent sends either `result` with a report or `error`. Gateway uses its own persisted node credential to call the existing `/api/worker/jobs/{id}/complete` or `/fail` endpoint. Reverse Agents never receive that credential.

Both sides exchange heartbeat/ping messages every 15 seconds. The Gateway removes connections silent for 45 seconds. The Worker reconnects with exponential backoff (1–30 seconds).

Job IDs plus the control-plane attempt number identify an execution. Duplicate dispatch for the same attempt returns 202 without a second Agent delivery; duplicate callbacks are safe. A later retry attempt may execute again after a failed attempt. Agents cache in-flight/completed execution promises for ten minutes. Gateway coordination caches results and renews active leases so a duplicate dispatch does not create concurrent execution.

Graceful Agent disconnect or Gateway shutdown produces an explicit failure callback, allowing the normal control-plane retry policy to run. If a Gateway is killed or loses control-plane connectivity before it can callback, no durable result is invented: authenticated heartbeat renewal stops and the existing stale-job recovery returns the job to the queue after its lease window.

## Multi-Gateway coordination

`GatewayCoordination` separates connection routing from leases/results. `InMemoryGatewayCoordination` is the only supported implementation, so a Gateway deployment must remain single-instance. Add an external coordination implementation only when multi-Gateway routing becomes a concrete deployment requirement.

The control plane registers a Gateway as a node using the existing registration endpoint with runtime data:

```json
{
  "name":"gateway-primary",
  "platform":"gateway",
  "version":"1",
  "capabilities":["reddit","rss","rest","web"],
  "maxConcurrency":16,
  "runtime":{"transport":"gateway-ws","endpoint":"https://gateway.example.com","token":"CONTROL_TOKEN"}
}
```

The endpoint and token are encrypted in the control-plane database and removed from public runtime metadata. Control-plane Gateway dispatch only waits for the three-second Agent ACK (with an eight-second HTTP envelope), then finalizes asynchronously through the authenticated callback. Long collection/analysis tasks are no longer failed at 15 seconds. Direct HTTP Agents retain the original synchronous 15-second compatibility behavior. Execution is at-least-once across catastrophic process/network loss, with job/attempt idempotency limiting duplicate work.

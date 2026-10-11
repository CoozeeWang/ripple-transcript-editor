# Ripple connection service

This experimental public relay is not the current product route. The maintainer chose personal/local client connections instead. See [Local AI connections](LOCAL_AI_CONNECTIONS.md). No public service is deployed or required by the current desktop flow.

This service implements the simplified connection flow. Users add **Ripple** in their AI application, open **Settings → AI-assisted editing → Connect Ripple**, and enter the displayed one-use pairing code on the authorization page. They do not install a transport program or enter a tunnel ID, API key, or server address. The desktop connection switch controls access to the currently open interview. Saved authorization survives restarting the desktop and service. **Disconnect and revoke** invalidates the device and all its AI authorizations.

The service is not deployed publicly yet. A build without `RIPPLE_CONNECTION_URL` clearly reports that the service is unavailable. Local HTTP is allowed only on loopback for development. ChatGPT, other AI clients, Windows, public distribution and deployment require their own compatibility/acceptance checks; a local test does not establish these results.

## Local development

Use separate absolute data directories outside the repository. In the backend environment:

```sh
RIPPLE_CONNECTION_URL=http://127.0.0.1:18801 \
RIPPLE_RELAY_DATA_DIR=/absolute/path/outside-repository/relay \
python -m app.connection_service
```

Compile the desktop with the same `RIPPLE_CONNECTION_URL`. Desktop credentials are saved in its protected application data, not in interview files. The service exposes `/mcp` and standard OAuth metadata, registration, authorization, token and revocation routes. It uses the MCP SDK's OAuth handlers and PKCE S256. Register a public OAuth client using `token_endpoint_auth_method: none`, `interview` scope and the exact `/mcp` resource. Client ID Metadata Documents are not advertised. The consent page supports English and Chinese together and asks for the code displayed in Ripple.

The worker makes outbound authenticated requests. No inbound desktop port, network router configuration or OpenAI tunnel is necessary. Only Ripple's local broker can execute interview operations. There are still 13 tools; desktop editing and marks use the same scope, timestamp, comparison and save rules as the local connector.

## Deployment

A container recipe is provided at `backend/Dockerfile.connection`. Supply a public HTTPS origin as `RIPPLE_CONNECTION_URL`, compile the desktop with that origin, put a TLS reverse proxy in front of the service, and preserve the original Host. Configure `RIPPLE_RELAY_BIND=0.0.0.0` inside the container. Mount persistent protected storage at `RIPPLE_RELAY_DATA_DIR`. Run **one** service process/replica: interview queues deliberately live only in its memory. Do not enable HTTP access/body logs at the service or proxy. URLs can contain short-lived authorization codes.

Before a public deployment, verify TLS, proxy/body/time limits, abuse protection, storage permissions, metadata/resource URLs, revocation and the actual AI application's OAuth flow. Registration/consent/enrollment are rate limited per direct peer, and request bodies are limited to 1 MiB. A proxy needs its own client-IP rate limiting because this service does not trust forwarded IP headers. Deployment and domain costs are separate from the code. Persistent device/OAuth metadata requires protected backups; expired records are pruned on writes and total records are bounded.

The database stores device and OAuth metadata with hashed secret lookup keys; it never stores interview text or audio. RPC arguments/results live in memory for at most the active request (125-second deadline), with 256 concurrent requests maximum. Source text sent to an AI application leaves the computer and passes through this service. Audio is never part of this connection.

## Failure handling

Pairing codes expire after 10 minutes, are single use, and generating another code invalidates the previous one for that device. Authorization codes expire after one minute and use PKCE. Access tokens last one hour; refresh tokens last 30 days and rotate on use. Device credentials last one year. A device must be paired before it can poll or advertise readiness. Revocation invalidates existing tokens and refresh credentials immediately, including established MCP requests before dispatch.

The desktop worker reconnects with bounded backoff after network outages. It retries only delivering a result with its original request ID; it never sends a completed/uncertain local write again. Writes that lose their response must be checked through task status and the Ripple UI. Turning the connection off or closing Ripple stops transport and disables the local editor session. Stopping a transport cannot undo a save that has already begun. Service restarts discard pending RPCs, so clients must treat interrupted writes as uncertain rather than retrying them automatically.

Tests use synthetic interviews/devices and temporary data only. Run:

```sh
PYTHONPATH=backend backend/.venv/bin/pytest backend/tests/test_connection_service.py backend/tests/test_connector_relay.py backend/tests/test_connector.py
npm --prefix frontend test -- ConnectorSetup.test.tsx useAIConnector.test.ts aiConnector.test.ts
```

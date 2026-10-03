# Extensions implementation and verification

MCP tools, resources, prompts, OAuth, local skills and the core local plugin runtime are operational. Broader plugin contributions and several other capabilities remain pending.

## MCP

- The standard `@modelcontextprotocol/sdk` 1.31.0 client uses stdio, Streamable HTTP or legacy SSE. The connection mode is explicit in settings; there is no implicit fallback to an unrelated endpoint.
- Local programs use an argument array without a shell. Windows disconnect/shutdown kills the owned process tree. Other-platform descendant behavior still requires an audit.
- Bearer tokens and process environment variables are encrypted in the main process. Credentials are bound to a destination fingerprint; changing the program/arguments/directory or remote address clears the saved secret. Model-provider keys use a separate namespace.
- Auto-connect defaults to false and is reset to false on backup restoration. Model calls require exact per-action approval. The settings tool-test button explicitly submits the entered parameters immediately.
- Tool schemas retain optional fields; Responses and Chat Completions receive `strict: false` for external tools. Anthropic receives the original input schema. Hashed protocol names avoid collisions; execution records display server/tool names.
- A run captures a connection and tool catalog. Disabled tools, configuration edits, disconnection, reconnects and catalog changes invalidate stale bindings. Stopping cancels the SDK request and releases pending approval.
- Requests are bounded by the configured 1–180 second timeout, including a legacy SSE handshake that does not otherwise settle on abort. The catalog is limited to 20 pages, 1000 tools and 2 MB of schemas; duplicate names and cyclic cursors are rejected. At most 120 MCP tools may be selected; all conversation tools together are limited to 128.
- Arguments are checked against the server input schema before approval. Outputs are bounded to 64 KB. Text and structured results reach the model; image/audio results currently carry descriptive metadata. HTTP redirects and cross-origin advertised endpoints are rejected before forwarding static credentials.

Verification uses real SDK protocol peers, actual stdio subprocesses and loopback HTTP/SSE servers. It covers success, bad arguments, denial, cancellation, catalog/configuration changes, startup errors, timeout, redirects and Windows process cleanup. Desktop verification exercises settings, discovery/test and Responses continuation through renderer/preload/main, including approval restoration after renderer reload.

### Resources and prompts

- The connected server advertises resources, RFC 6570 URI templates and named prompts with required/optional string arguments. Catalogs are bounded to 20 pages, 1000 entries and 2 MB per kind; duplicate identities and cyclic cursors fail clearly. Servers without the optional resource-template RPC remain supported.
- List-change notifications update the catalog. The refresh button requests a new catalog from the server, including servers that do not send notifications. Old content selections and approved proposals are invalidated when the catalog or connection changes.
- Resource reads accept only advertised URIs or a matching template. Prompt requests reject missing required or unknown arguments. Text previews are limited to 256 KB and 100 items; binary results currently show URI, MIME type and size, with a 2 MB limit per item.
- Content can be appended to the existing composer draft for editing. Prompt message roles and embedded source URIs remain visible; a returned prompt is data, and is never automatically submitted or installed as system instructions.
- Selected servers provide paginated resource/prompt discovery tools to the model. Reading a remote resource or loading a prompt requires approval for the exact request; metadata discovery uses the captured local catalog. Cancellation reaches the SDK request.

Protocol and desktop tests cover template expansion, text/binary metadata, prompt arguments, manual refresh, stale catalogs, malformed results and size limits, approvals, real model continuation and preservation of an existing draft. Light/dark and minimum-window layouts are checked, including long URI wrapping.

### OAuth

- Remote HTTP/SSE connections use the SDK's authorization discovery, dynamic registration, PKCE and token exchange. Pre-registered client ID, issuer, optional client secret/scope and fixed callback port are also configurable.
- Only an explicit login action opens authorization. Background connections and failed refreshes enter `auth-required`; they never open a browser automatically. The UI offers cancellation and explicit sign-out.
- A temporary listener binds only to `127.0.0.1`. Callback state uses cryptographic randomness and constant-time comparison; wrong state, invalid/missing code, unrelated paths, denial and replay are rejected. Login expires after five minutes. Cancellation/shutdown closes the listener.
- Authorization codes, state and PKCE verifiers remain in memory. Tokens and client registration are encrypted in a separate credential namespace. SDK issuer bindings are stored unchanged. Credentials are tied to endpoint/auth/client configuration, excluded from workspace backups and cleared on explicit sign-out or configuration replacement. A failed settings write rolls back both credential stores.
- Silent refresh and saved-login reconnect are supported. Dynamic client registration keeps its callback URI across restarts. OAuth endpoints require HTTPS; HTTP is permitted for a configured local loopback server. Access tokens cannot be forwarded to a different origin, and HTTP redirects are rejected.

Tests exercise actual HTTP and legacy SSE discovery/registration/PKCE/token exchange, pre-registered clients with a secret and fixed callback, refresh rotation, failed refresh (including notification-driven catalog refresh), timeout/cancellation, state validation, issuer preservation, persistence and rollback. Desktop tests use a real isolated Chrome instance for consent and a real app restart for saved-login reuse/sign-out. Only the external-launch boundary is intercepted in the test process; a native default-browser launch and live third-party identity-provider audit remain pending.

## Plugins

The independent `qiyao-plugin.json` format and granted APIs are documented in [PLUGINS.md](PLUGINS.md). Complete managed import pins all assets; packages start disabled. Tools, commands and panels run with explicit grants. Model tools require exact approval; project writes require an additional content approval and matching file revision. Project scope, active invocation ownership and current grants are checked by the host rather than by plugin code.

A hidden sandboxed renderer with its own nonpersistent browser partition runs JavaScript modules without Node or application IPC. HTML panels use a separate per-plugin origin and a message bridge that checks source/origin. Device permissions and raw external network access are denied. Own storage is bounded workspace JSON; the network API allows exact declared hosts with redirect/timeout/response bounds. Startup and handler deadlines, stopping, grant changes, reload and runtime failures clear stale callbacks. Crashes disable the affected plugin. Removing a scoped project disables affected plugins rather than broadening their scope.

Backups include complete pinned packages and own data. Restore verifies metadata, creates new UUID folders, remaps thread selections and removes executable grants. Existing managed copies and source licenses remain intact; failed persistence cleans up only new copies. Unit tests cover permissions, invalid arguments, denial, revoked/stale contexts, project revisions, storage, network bounds, cancellation, lifecycle and backup rollback. Native tests cover real runtime/workspace-panel isolation, keyboard/pointer commands, model continuation and separate file approval, stop/reload, renderer crash, protocol setup failure, startup timeout, complete export/restore and app restart. Broader contributions, remote catalogs, docking, native picker interaction and other-platform audits remain pending.

## Skills

- Import accepts a folder containing `SKILL.md` and copies its full supported contents into an independently managed UUID directory. Original files are never removed. Licenses and binary assets are preserved.
- `.git`, `node_modules` and Python caches are omitted. Private credential files and symbolic links are rejected with an explicit error; environment templates are accepted. Limits are 1000 files, 20 MB total, 2 MB per asset and 64 KB for skill instructions/text reads.
- YAML metadata supports a name and description with bounded aliases. Without frontmatter, the folder name is used. Empty instructions and invalid UTF-8 fail clearly.
- A selected skill contributes only its metadata initially. `load_skill` returns its complete instructions and a bounded supporting-file list; `read_skill_file` reads a scoped UTF-8 reference. Oversized instructions that cannot fit the tool result return an error rather than silently losing part of the instructions. Reading does not run scripts.
- Disabled/unselected skills cannot be loaded. Removing/disabling a selected skill stops related active runs. Removing a managed copy preserves the original source.
- JSON workspace backups include every skill asset as a bounded base64 bundle. Restore creates new UUID directories and remaps thread selections, preserving existing managed folders for recovery. Failed persistence removes newly created copies. Legacy backups with missing assets leave those skill entries disabled.

Unit tests cover complete import, license/binary retention, metadata/errors, boundaries, progressive reads, enable/remove, backups/remapping and rollback. Desktop tests use a main-process folder-dialog fixture to exercise the import path; a native interactive picker test remains pending.

Primary protocol references: [official client documentation](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/docs/client.md), [official SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x), [authorization specification](https://modelcontextprotocol.io/specification/latest/basic/authorization), [official OAuth provider example](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/examples/client/simpleOAuthClientProvider.ts). Dependency licenses must be retained in the distribution audit.

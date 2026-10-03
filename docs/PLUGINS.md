# Qiyao local plugin packages

This independently defined format supports local tools, commands and isolated HTML panels. It is not a compatibility claim for another application's plugin format. Provider contributions, shared services, event hooks, remote installation, updates and broader contributions remain pending.

Import a folder containing `qiyao-plugin.json` from Settings → 本地插件. Import preserves supported files, licenses and binary assets in a managed UUID directory; it does not run code. Enable the plugin and explicitly grant the capabilities you want. Saving grants stops related conversations and replaces the runtime. Runtime errors disable the plugin. Restart activates previously enabled packages only after their pinned assets are verified.

## Package manifest

```json
{
  "schemaVersion": 1,
  "id": "example.notes",
  "name": "Local notes",
  "version": "1.0.0",
  "description": "A small personal notes plugin",
  "main": "main.js",
  "permissions": ["tools", "commands", "panels", "storage"],
  "tools": [{
    "name": "echo",
    "description": "Echo optional text",
    "parameters": {
      "type": "object",
      "properties": { "text": { "type": "string" } },
      "additionalProperties": false
    }
  }],
  "commands": [{ "id": "count", "title": "Count uses" }],
  "panels": [{ "id": "notes", "title": "Notes", "entry": "ui/index.html" }]
}
```

Use unique package IDs and contribution names. Entries are relative paths, and a main entry must be a JavaScript module. Tools require object JSON schemas; each tool may declare a `timeout` between 100 and 180000 milliseconds (default 60000). A package may declare up to 50 tools, 50 commands and 20 panels. The runtime must register exactly its declared tools and commands.

Package limits are 1000 files, 20 MB total and 2 MB per file. The manifest is limited to 256 KB. Git/dependency/cache directories are omitted. Symlinks and private credential files are rejected; environment templates are allowed. SHA-256 pins cover every imported file, and changed assets require a fresh import. Duplicate package IDs are rejected rather than silently replacing a running package.

## Runtime module

```js
export default function activate(api) {
  api.registerTool('echo', async (args) => ({ text: args.text ?? 'Hello' }));
  api.registerCommand('count', async () => {
    const count = (await api.call('storage.get', { key: 'uses' }) ?? 0) + 1;
    await api.call('storage.set', { key: 'uses', value: count });
    return { count };
  });
  api.onDeactivate(() => { /* dispose timers or subscriptions */ });
}
```

Export either a default activation function or `activate`. An optional exported `deactivate` function is also supported. Activation has a 10-second deadline. Deactivation has a 1.5-second deadline before the window is destroyed. Commands receive JSON arguments and an invocation context; tool handlers receive validated object arguments and that context. Return JSON data (up to 256 KB); model output is further limited to 64 KB. Request arguments are limited to 64 KB, with up to 16 host requests in flight per plugin.

Code runs in a hidden sandboxed Electron renderer with context isolation and no Node integration. Raw filesystem, child-process, application IPC, device permission and external network access are unavailable. Its preload exposes only the plugin API. Each runtime uses its own nonpersistent browser partition. Stopping an active model invocation unloads the runtime; stale requests and invocation tokens become invalid. This also stops other work in that runtime.

## Granted host APIs

| Method | Permission | Parameters and behavior |
| --- | --- | --- |
| `context` | None | Own ID/name, language and configured theme; no workspace or credentials |
| `storage.get` | `storage` | `{ key }`; returns own saved JSON value or `null` |
| `storage.set` | `storage` | `{ key, value }`; value under 60 KB; own namespace total under 1 MB |
| `storage.delete` | `storage` | `{ key }`; deletes only own value |
| `project.read` | `project.read` | `{ path, start_line?, max_lines? }`; active invocation token required |
| `project.document` | `project.read` | `{ path }`; current UTF-8 text and SHA-256 revision, up to 256 KB of JSON; active invocation token required |
| `project.list` | `project.read` | `{ path? }`; active invocation token required |
| `project.write` | `project.write` | `{ path, content, expected_sha256 }`; active invocation and separate file approval required |
| `network.fetch` | `network` | `{ url, method?, headers?, body? }`; exact declared host and port, redirects rejected, 15-second deadline and 256 KB UTF-8 response limit |

Pass the handler's `context.token` as the third argument to `api.call` for project methods. The host binds that token to the invocation's chosen project and rechecks its path, scope and grants after approval. Private files and paths outside the project are rejected by the existing project tools. Write results retain the ordinary tool result shape, including `error`. An `expected_sha256` of `null` creates a new file only; existing files need the current hash returned by `project.document`. Changed revisions fail rather than overwrite another edit.

Network access requires both the permission and a `domains` list of exact host names, optionally with ports (for example `api.example.com` or `127.0.0.1:8000`). Requests use HTTP or HTTPS and return `{ status, contentType, text }`. Saved model/MCP/OAuth credentials are never supplied to a plugin. Plugin storage is ordinary workspace data, not an encrypted secret store.

Model tools are available only when selected in the composer and granted. Each call requires approval for its exact parameters; writes request another approval for the exact contents. Project analysis excludes plugin tools. User commands execute from the plugin settings page or unified command palette; a selected project is required for project APIs. Panels may invoke commands without a project, so panel commands cannot obtain project access.

## Isolated panels

```html
<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<link rel="stylesheet" href="/_qiyao/theme.css">
<button id="count">Count uses</button>
<pre id="result"></pre>
<script type="module" src="panel.js"></script>
</html>
```

```js
import api from '/_qiyao/panel-sdk.js';
document.querySelector('#count').addEventListener('click', async () => {
  try {
    const result = await api.call('command.run', { name: 'count', arguments: {} });
    document.querySelector('#result').textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    document.querySelector('#result').textContent = error.message;
  }
});
```

Each managed UUID has a distinct `qiyao-plugin://` origin, different from `qiyao://app`. The iframe allows scripts and its own origin so modules and relative assets work. Parent access stays blocked by the origin boundary. The parent verifies both message source and origin and supplies a fixed plugin identity to the host; panel messages cannot select a different plugin. Nested frames, forms, popups, inline scripts and external fetches are blocked. The panel SDK supports permission-checked context/storage/network calls and `command.run`; it has no invocation token for project APIs.

The optional theme stylesheet supplies reference light/dark colors, OpenAI Sans with the Chinese fallback, compact controls and focus colors. The parent updates `data-theme` on theme changes. Complete plugin resources and their original licenses remain intact. Opening a panel closes settings and displays it in the main workspace, with a close control that returns to chat. Docking/floating workflows and richer UI contributions remain pending.

Register panel controls before awaiting initial host data, and keep them disabled until initialization finishes. The verification panel follows this pattern and also reports pending/error states. Desktop tests activate its real command through both focus/Enter and a Chromium pointer click, verify the received pointer event and retained data, and inspect the minimum-window dark layout.

## Command palette

Open with Ctrl Shift P or search with a leading `>` in Ctrl K. Only enabled packages with the corresponding command/panel grant contribute entries; unavailable runtimes remain disabled. Selecting a command opens an inert plain-text preview, a JSON argument field (up to 64000 characters) and a project selector restricted to the existing plugin scope. Execution requires the explicit button and uses the same host permission, runtime and project-approval path as settings. Arguments are retained after malformed JSON, handler failure or grant revocation. Refresh rechecks state and disables a revoked command without clearing its parameters. Panel selection uses the existing isolated workspace panel; its separate grant cannot bypass command or project permissions. See [COMMANDS.md](COMMANDS.md).

## Backup behavior

Workspace JSON/gzip backups include every plugin asset, pinned metadata and own data. Restore verifies the files against the recorded manifest and hashes, creates new UUID directories and remaps conversation selections. Restored plugins are disabled and have no grants until explicitly authorized again. Existing managed copies remain available for recovery. Failed import/restore persistence removes only the new copies. The complete JSON payload is bounded to 256 MB, with a separate 64 MB compressed-file limit. See [BACKUPS.md](BACKUPS.md).

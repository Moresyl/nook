import { z } from 'zod';

export const pluginPermissions = ['tools', 'commands', 'panels', 'storage', 'project.read', 'project.write', 'network'] as const;
export const pluginPermissionSchema = z.enum(pluginPermissions);
export const packagePathSchema = z.string().min(1).max(4096).refine((path) => !/[:\0]/.test(path) && !path.startsWith('/') && path.split(/[\\/]/).every((part) => part && part !== '.' && part !== '..'), 'Use a relative package file path');
const localName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
const json = z.unknown().refine((value) => { try { const text = JSON.stringify(value); return Boolean(text) && text.length <= 64_000 && JSON.stringify(JSON.parse(text!)) === text; } catch { return false; } }, 'Use JSON data smaller than 64 KB');
export const pluginManifestSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,99}$/),
  name: z.string().trim().min(1).max(80), version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),
  description: z.string().max(2000).default(''), author: z.string().max(160).default(''),
  main: packagePathSchema.optional(), permissions: z.array(pluginPermissionSchema).max(7).default([]),
  domains: z.array(z.string().min(1).max(253).refine((value) => {
    try { const url = new URL(`https://${value}`); return url.host === value.toLowerCase() && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password; } catch { return false; }
  }, 'Use exact host names with an optional port')).max(30).default([]),
  tools: z.array(z.object({ name: localName, description: z.string().max(4000), parameters: z.record(z.string(), z.unknown()), timeout: z.number().int().min(100).max(180_000).default(60_000) }).strict()).max(50).default([]),
  commands: z.array(z.object({ id: localName, title: z.string().min(1).max(100), description: z.string().max(2000).default('') }).strict()).max(50).default([]),
  panels: z.array(z.object({ id: localName, title: z.string().min(1).max(100), entry: packagePathSchema }).strict()).max(20).default([]),
}).strict().superRefine((manifest, context) => {
  for (const [field, permission] of [['tools', 'tools'], ['commands', 'commands'], ['panels', 'panels']] as const) {
    if (manifest[field].length && !manifest.permissions.includes(permission)) context.addIssue({ code: 'custom', path: ['permissions'], message: `Declare the ${permission} permission` });
    const names = manifest[field].map((item) => 'name' in item ? item.name : item.id);
    if (new Set(names).size !== names.length) context.addIssue({ code: 'custom', path: [field], message: 'Contribution names must be unique' });
  }
  if ((manifest.tools.length || manifest.commands.length) && !manifest.main) context.addIssue({ code: 'custom', path: ['main'], message: 'Tools and commands require a JavaScript entry' });
  if (new Set(manifest.permissions).size !== manifest.permissions.length) context.addIssue({ code: 'custom', path: ['permissions'], message: 'Permissions must be unique' });
  if (manifest.permissions.includes('network') !== Boolean(manifest.domains.length)) context.addIssue({ code: 'custom', path: ['domains'], message: 'Network access requires the permission and an explicit host list' });
  if (manifest.main && !/\.(?:m?js)$/.test(manifest.main)) context.addIssue({ code: 'custom', path: ['main'], message: 'Use a JavaScript module entry' });
});
export const pluginSchema = z.object({
  id: z.uuid(), manifest: pluginManifestSchema, enabled: z.boolean().default(false),
  grants: z.array(pluginPermissionSchema).max(7).default([]), projectIds: z.array(z.string().min(1).max(128)).max(100).default([]),
  installedAt: z.number().int().nonnegative(),
  hashes: z.record(packagePathSchema, z.string().regex(/^[a-f0-9]{64}$/)).refine((files) => Object.keys(files).length <= 1000),
  data: z.record(z.string().min(1).max(128), json).default({}).refine((value) => JSON.stringify(value).length <= 1_000_000, 'Plugin storage exceeds 1 MB'),
}).superRefine((plugin, context) => {
  if (plugin.grants.some((permission) => !plugin.manifest.permissions.includes(permission)) || new Set(plugin.grants).size !== plugin.grants.length) context.addIssue({ code: 'custom', path: ['grants'], message: 'Grant only permissions requested by this plugin' });
});
export const pluginUpdateSchema = z.object({ id: z.uuid(), enabled: z.boolean(), grants: z.array(pluginPermissionSchema).max(7), projectIds: z.array(z.string().min(1).max(128)).max(100) }).strict();
export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type Plugin = z.infer<typeof pluginSchema>;
export type PluginUpdate = z.infer<typeof pluginUpdateSchema>;
export type PluginPermission = z.infer<typeof pluginPermissionSchema>;
export type PluginView = { id: string; status: 'disabled' | 'loading' | 'running' | 'stopped' | 'error'; error?: string };
export type PluginInvocation = { id: string; kind: 'tool' | 'command' | 'deactivate'; name: string; arguments: unknown; context: { token: string; projectId?: string; mode: string } };

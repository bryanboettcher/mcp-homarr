#!/usr/bin/env node

/**
 * MCP Server for Homarr v1.x (homarr-labs/homarr)
 *
 * Uses consolidated domain tools for progressive enhancement —
 * 13 tools instead of 65, reducing context window footprint while
 * maintaining full functionality. Each tool covers a domain with
 * an action parameter for specific operations.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { HomarrClient } from "./client.js";

const HOMARR_URL = process.env.HOMARR_URL ?? "http://localhost:7575";
const HOMARR_API_KEY = process.env.HOMARR_API_KEY ?? "";
const HOMARR_USERNAME = process.env.HOMARR_USERNAME ?? "";
const HOMARR_PASSWORD = process.env.HOMARR_PASSWORD ?? "";

if (!HOMARR_API_KEY && (!HOMARR_USERNAME || !HOMARR_PASSWORD)) {
  console.error("Set HOMARR_API_KEY, or both HOMARR_USERNAME and HOMARR_PASSWORD");
  process.exit(1);
}

const client = new HomarrClient({
  baseUrl: HOMARR_URL,
  apiKey: HOMARR_API_KEY || undefined,
  username: HOMARR_USERNAME || undefined,
  password: HOMARR_PASSWORD || undefined,
});

const server = new McpServer({
  name: "homarr",
  version: "2.0.0",
});

type Result = { content: Array<{ type: "text"; text: string }>; isError?: true };

function ok(data: unknown): Result {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(e: unknown): Result {
  const msg = e instanceof Error ? e.message : String(e);
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type P = Record<string, any>;

function q(procedure: string, input?: unknown) {
  return client.trpcQuery(procedure, input);
}
function m(procedure: string, input?: unknown) {
  return client.trpc(procedure, input);
}

// ─── Discovery ───────────────────────────────────────────────────────

server.tool(
  "homarr",
  `Homarr dashboard management. Use this tool to discover available domains and actions.
Returns: server info, stats, and a summary of all available management domains.`,
  {
    action: z.enum(["info", "stats", "check_updates", "server_settings"]).describe(
      "info: version info | stats: dashboard statistics | check_updates: available updates | server_settings: all settings"
    ),
  },
  async ({ action }) => {
    try {
      switch (action) {
        case "info": return ok(await q("info.getInfo"));
        case "stats": return ok(await q("home.getStats"));
        case "check_updates": return ok(await q("updateChecker.getAvailableUpdates"));
        case "server_settings": return ok(await q("serverSettings.getAll"));
      }
    } catch (e) { return err(e); }
  }
);

// ─── Boards ──────────────────────────────────────────────────────────

server.tool(
  "homarr_boards",
  `Manage Homarr boards (dashboards). Boards contain sections with widgets and app tiles.
Actions: list, get, search, exists, permissions, create, rename, duplicate, delete, set_visibility, set_home, save_settings, save_layout`,
  {
    action: z.enum([
      "list", "get", "search", "exists", "permissions", "home",
      "create", "rename", "duplicate", "delete", "set_visibility", "set_home",
      "save_settings", "save_layout",
    ]).describe("Operation to perform"),
    params: z.record(z.string(), z.any()).optional().describe(
      `Action parameters:
- list: {} (no params)
- get: {name: string} — get by board name, returns sections/items/layouts
- search: {query: string, limit?: number}
- exists: {name: string} — check if name is taken
- permissions: {id: string}
- home: {} — get user's home board
- create: {name: string, columnCount: number, isPublic: boolean} — name must be alphanumeric/dash/underscore
- rename: {id: string, name: string}
- duplicate: {id: string, name: string}
- delete: {id: string}
- set_visibility: {id: string, visibility: "public"|"private"}
- set_home: {id: string}
- save_settings: {id: string, ...} — optional: pageTitle, logoImageUrl, faviconImageUrl, backgroundImageUrl, backgroundImageAttachment, backgroundImageSize, primaryColor (#RRGGBB), secondaryColor, opacity (0-100), customCss, itemRadius (xs|sm|md|lg|xl), disableStatus
- save_layout: {id: string, sections: [...], items: [...]} — use "get" first to read current structure`
    ),
  },
  async ({ action, params: p }) => {
    const v: P = p ?? {};
    try {
      switch (action) {
        case "list": return ok(await q("board.getAllBoards"));
        case "get": return ok(await q("board.getBoardByName", { name: v.name }));
        case "search": return ok(await q("board.search", { query: v.query, limit: v.limit ?? 10 }));
        case "exists": return ok(await q("board.exists", v.name));
        case "permissions": return ok(await q("board.getBoardPermissions", { id: v.id }));
        case "home": return ok(await q("board.getHomeBoard"));
        case "create": return ok(await m("board.createBoard", { name: v.name, columnCount: v.columnCount, isPublic: v.isPublic }));
        case "rename": return ok(await m("board.renameBoard", { id: v.id, name: v.name }) ?? { success: true });
        case "duplicate": return ok(await m("board.duplicateBoard", { id: v.id, name: v.name }) ?? { success: true });
        case "delete": return ok(await m("board.deleteBoard", { id: v.id }) ?? { success: true });
        case "set_visibility": return ok(await m("board.changeBoardVisibility", { id: v.id, visibility: v.visibility }) ?? { success: true });
        case "set_home": return ok(await m("board.setHomeBoard", { id: v.id }) ?? { success: true });
        case "save_settings": {
          const { id, ...settings } = v;
          const cleaned = Object.fromEntries(Object.entries(settings).filter(([, val]) => val !== undefined));
          return ok(await m("board.savePartialBoardSettings", { id, ...cleaned }) ?? { success: true });
        }
        case "save_layout": return ok(await m("board.saveBoard", { id: v.id, sections: v.sections, items: v.items }) ?? { success: true });
        default: return err(`Unknown action: ${action}`);
      }
    } catch (e) { return err(e); }
  }
);

// ─── Apps ────────────────────────────────────────────────────────────

server.tool(
  "homarr_apps",
  `Manage Homarr apps (bookmarks/service links with icons and optional status pinging).
Actions: list, search, get, create, create_bulk, update, delete`,
  {
    action: z.enum(["list", "search", "get", "create", "create_bulk", "update", "delete"]).describe("Operation to perform"),
    params: z.record(z.string(), z.any()).optional().describe(
      `Action-specific parameters:
- list: {} (no params)
- search: {query: string, limit?: number}
- get: {id: string}
- create: {name: string, iconUrl: string, href?: string, pingUrl?: string, description?: string}
- create_bulk: {apps: [{name, iconUrl?, href?, pingUrl?, description?}, ...]}
- update: {id: string, name: string, iconUrl: string, href?: string, pingUrl?: string, description?: string}
- delete: {id: string}`
    ),
  },
  async ({ action, params: p }) => {
    const v: P = p ?? {};
    try {
      switch (action) {
        case "list": return ok(await q("app.all"));
        case "search": return ok(await q("app.search", { query: v.query, limit: v.limit ?? 10 }));
        case "get": return ok(await q("app.byId", { id: v.id }));
        case "create": return ok(await m("app.create", {
          name: v.name, iconUrl: v.iconUrl,
          href: v.href || null, pingUrl: v.pingUrl || null, description: v.description || null,
        }));
        case "create_bulk": {
          const apps = (v.apps as any[]).map((a) => ({
            name: a.name, iconUrl: a.iconUrl || null,
            href: a.href || null, pingUrl: a.pingUrl || null, description: a.description || null,
          }));
          return ok(await m("app.createMany", apps));
        }
        case "update": return ok(await m("app.update", {
          id: v.id, name: v.name, iconUrl: v.iconUrl,
          href: v.href || null, pingUrl: v.pingUrl || null, description: v.description || null,
        }) ?? { success: true });
        case "delete": return ok(await m("app.delete", { id: v.id }) ?? { success: true });
        default: return err(`Unknown action: ${action}`);
      }
    } catch (e) { return err(e); }
  }
);

// ─── Users ───────────────────────────────────────────────────────────

server.tool(
  "homarr_users",
  `Manage Homarr users. Most actions require admin permissions.
Actions: list, get, search, create, delete`,
  {
    action: z.enum(["list", "get", "search", "create", "delete"]).describe("Operation to perform"),
    params: z.record(z.string(), z.any()).optional().describe(
      `Action-specific parameters:
- list: {} (no params)
- get: {userId: string}
- search: {query: string, limit?: number}
- create: {username: string, password: string, confirmPassword: string, email?: string, groupIds?: string[]}
  Password: min 8 chars, must contain upper+lower+digit+special character
- delete: {userId: string}`
    ),
  },
  async ({ action, params: p }) => {
    const v: P = p ?? {};
    try {
      switch (action) {
        case "list": return ok(await q("user.getAll"));
        case "get": return ok(await q("user.getById", { userId: v.userId }));
        case "search": return ok(await q("user.search", { query: v.query, limit: v.limit ?? 10 }));
        case "create": return ok(await m("user.create", {
          username: v.username, password: v.password, confirmPassword: v.confirmPassword,
          email: v.email || undefined, groupIds: v.groupIds ?? [],
        }));
        case "delete": return ok(await m("user.delete", { userId: v.userId }) ?? { success: true });
        default: return err(`Unknown action: ${action}`);
      }
    } catch (e) { return err(e); }
  }
);

// ─── Integrations ────────────────────────────────────────────────────

server.tool(
  "homarr_integrations",
  `Manage Homarr integrations (connections to external services like Sonarr, Radarr, Plex, Pi-hole, etc.).
Actions: list, get, search, create, update, delete`,
  {
    action: z.enum(["list", "get", "search", "create", "update", "delete"]).describe("Operation to perform"),
    params: z.record(z.string(), z.any()).optional().describe(
      `Action-specific parameters:
- list: {} (no params)
- get: {id: string} — includes secrets
- search: {query: string, limit?: number}
- create: {name: string, kind: string, url: string, secrets: [{kind: string, value: string}, ...]}
  kind examples: sonarr, radarr, jellyfin, piHole, adGuardHome, sabNzbd, overseerr, plex
- update: {id: string, name: string, url: string, secrets: [{kind: string, value?: string}, ...]}
- delete: {id: string}`
    ),
  },
  async ({ action, params: p }) => {
    const v: P = p ?? {};
    try {
      switch (action) {
        case "list": return ok(await q("integration.all"));
        case "get": return ok(await q("integration.byId", { id: v.id }));
        case "search": return ok(await q("integration.search", { query: v.query, limit: v.limit ?? 10 }));
        case "create": return ok(await m("integration.create", {
          name: v.name, kind: v.kind, url: v.url, secrets: v.secrets,
          attemptSearchEngineCreation: false,
        }));
        case "update": return ok(await m("integration.update", {
          id: v.id, name: v.name, url: v.url, secrets: v.secrets,
        }) ?? { success: true });
        case "delete": return ok(await m("integration.delete", { id: v.id }) ?? { success: true });
        default: return err(`Unknown action: ${action}`);
      }
    } catch (e) { return err(e); }
  }
);

// ─── Groups ──────────────────────────────────────────────────────────

server.tool(
  "homarr_groups",
  `Manage Homarr groups (permission groups for users). Admin only.
Actions: list, get, create, delete, add_member, remove_member`,
  {
    action: z.enum(["list", "get", "create", "delete", "add_member", "remove_member"]).describe("Operation to perform"),
    params: z.record(z.string(), z.any()).optional().describe(
      `Action-specific parameters:
- list: {} (no params)
- get: {id: string}
- create: {name: string}
- delete: {id: string}
- add_member: {groupId: string, userId: string}
- remove_member: {groupId: string, userId: string}`
    ),
  },
  async ({ action, params: p }) => {
    const v: P = p ?? {};
    try {
      switch (action) {
        case "list": return ok(await q("group.getAll"));
        case "get": return ok(await q("group.getById", { id: v.id }));
        case "create": return ok(await m("group.createGroup", { name: v.name }));
        case "delete": return ok(await m("group.deleteGroup", { id: v.id }) ?? { success: true });
        case "add_member": return ok(await m("group.addMember", { groupId: v.groupId, userId: v.userId }) ?? { success: true });
        case "remove_member": return ok(await m("group.removeMember", { groupId: v.groupId, userId: v.userId }) ?? { success: true });
        default: return err(`Unknown action: ${action}`);
      }
    } catch (e) { return err(e); }
  }
);

// ─── Invites ─────────────────────────────────────────────────────────

server.tool(
  "homarr_invites",
  `Manage user invitations. Admin only.
Actions: list, create, delete`,
  {
    action: z.enum(["list", "create", "delete"]).describe("Operation to perform"),
    params: z.record(z.string(), z.any()).optional().describe(
      `Action-specific parameters:
- list: {} (no params)
- create: {expirationDate: string} — ISO 8601 format
- delete: {id: string}`
    ),
  },
  async ({ action, params: p }) => {
    const v: P = p ?? {};
    try {
      switch (action) {
        case "list": return ok(await q("invite.getAll"));
        case "create": {
          if (!v.expirationDate) return err("expirationDate is required (ISO 8601 string)");
          const d = new Date(v.expirationDate);
          if (isNaN(d.getTime())) return err(`Invalid expirationDate: ${v.expirationDate}`);
          return ok(await m("invite.createInvite", { expirationDate: d }));
        }
        case "delete": return ok(await m("invite.deleteInvite", { id: v.id }) ?? { success: true });
        default: return err(`Unknown action: ${action}`);
      }
    } catch (e) { return err(e); }
  }
);

// ─── Docker ──────────────────────────────────────────────────────────

server.tool(
  "homarr_docker",
  `Manage Docker containers visible to Homarr. Admin only.
Actions: list, start, stop, restart, remove`,
  {
    action: z.enum(["list", "start", "stop", "restart", "remove"]).describe("Operation to perform"),
    params: z.record(z.string(), z.any()).optional().describe(
      `Action-specific parameters:
- list: {} (no params)
- start: {ids: string[]}
- stop: {ids: string[]}
- restart: {ids: string[]}
- remove: {ids: string[]}`
    ),
  },
  async ({ action, params: p }) => {
    const v: P = p ?? {};
    try {
      switch (action) {
        case "list": return ok(await q("docker.getContainers"));
        case "start": return ok(await m("docker.startAll", { ids: v.ids }) ?? { success: true });
        case "stop": return ok(await m("docker.stopAll", { ids: v.ids }) ?? { success: true });
        case "restart": return ok(await m("docker.restartAll", { ids: v.ids }) ?? { success: true });
        case "remove": return ok(await m("docker.removeAll", { ids: v.ids }) ?? { success: true });
        default: return err(`Unknown action: ${action}`);
      }
    } catch (e) { return err(e); }
  }
);

// ─── Kubernetes ──────────────────────────────────────────────────────

server.tool(
  "homarr_kubernetes",
  `Query Kubernetes cluster data from Homarr. Admin only. Requires Kubernetes integration enabled in Homarr.
Actions: cluster, resource_counts, nodes, pods, services, namespaces`,
  {
    action: z.enum(["cluster", "resource_counts", "nodes", "pods", "services", "namespaces"]).describe(
      "cluster: version/metrics/capacity | resource_counts: resource totals | nodes/pods/services/namespaces: list resources"
    ),
  },
  async ({ action }) => {
    try {
      switch (action) {
        case "cluster": return ok(await q("kubernetes.cluster.getCluster"));
        case "resource_counts": return ok(await q("kubernetes.cluster.getClusterResourceCounts"));
        case "nodes": return ok(await q("kubernetes.nodes.getNodes"));
        case "pods": return ok(await q("kubernetes.pods.getPods"));
        case "services": return ok(await q("kubernetes.services.getServices"));
        case "namespaces": return ok(await q("kubernetes.namespaces.getNamespaces"));
        default: return err(`Unknown action: ${action}`);
      }
    } catch (e) { return err(e); }
  }
);

// ─── Icons ───────────────────────────────────────────────────────────

server.tool(
  "homarr_icons",
  "Search for icons from configured icon repositories. Use before creating apps to find the right iconUrl.",
  {
    searchText: z.string().describe("Search text for icon lookup"),
    limitPerGroup: z.number().optional().describe("Max results per icon group (default 20)"),
  },
  async ({ searchText, limitPerGroup }) => {
    try { return ok(await q("icon.findIcons", { searchText, limitPerGroup: limitPerGroup ?? 20 })); }
    catch (e) { return err(e); }
  }
);

// ─── Admin ───────────────────────────────────────────────────────────

server.tool(
  "homarr_admin",
  `Administrative operations: API keys, cron jobs, search engines, media, location search.
Actions: list_api_keys, create_api_key, delete_api_key, list_cron_jobs, trigger_cron_job, list_search_engines, list_media, search_city`,
  {
    action: z.enum([
      "list_api_keys", "create_api_key", "delete_api_key",
      "list_cron_jobs", "trigger_cron_job",
      "list_search_engines", "list_media", "search_city",
    ]).describe("Operation to perform"),
    params: z.record(z.string(), z.any()).optional().describe(
      `Action-specific parameters:
- list_api_keys: {} | create_api_key: {} | delete_api_key: {id: string}
- list_cron_jobs: {} | trigger_cron_job: {id: string}
- list_search_engines: {}
- list_media: {page?: number, pageSize?: number, search?: string}
- search_city: {query: string}`
    ),
  },
  async ({ action, params: p }) => {
    const v: P = p ?? {};
    try {
      switch (action) {
        case "list_api_keys": return ok(await q("apiKeys.getAll"));
        case "create_api_key": return ok(await m("apiKeys.create"));
        case "delete_api_key": return ok(await m("apiKeys.delete", { id: v.id }) ?? { success: true });
        case "list_cron_jobs": return ok(await q("cronJobs.getJobs"));
        case "trigger_cron_job": return ok(await m("cronJobs.triggerJob", { id: v.id }) ?? { success: true });
        case "list_search_engines": return ok(await q("searchEngine.getSelectable"));
        case "list_media": return ok(await q("media.getPaginated", {
          page: v.page ?? 0, pageSize: v.pageSize ?? 20, search: v.search ?? "",
        }));
        case "search_city": return ok(await q("location.searchCity", { query: v.query }));
        default: return err(`Unknown action: ${action}`);
      }
    } catch (e) { return err(e); }
  }
);

// ─── Start Server ────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Homarr MCP server v2 running (${HOMARR_URL})`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

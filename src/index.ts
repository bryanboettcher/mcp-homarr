#!/usr/bin/env node

/**
 * MCP Server for Homarr v1.x (homarr-labs/homarr)
 *
 * All API calls use tRPC via GET (queries) or POST (mutations).
 * Auth is handled by the HomarrClient (credentials -> session cookie).
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
  version: "1.0.0",
});

function ok(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(e: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
  const msg = e instanceof Error ? e.message : String(e);
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

// Helper to wrap query/mutation calls with error handling
function query(procedure: string, input?: unknown) {
  return client.trpcQuery(procedure, input);
}
function mutate(procedure: string, input?: unknown) {
  return client.trpc(procedure, input);
}

// ─── Info & Home ─────────────────────────────────────────────────────

server.tool(
  "get_info",
  "Get Homarr server version info",
  {},
  async () => {
    try { return ok(await query("info.getInfo")); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "get_stats",
  "Get Homarr dashboard statistics (board count, user count, app count, etc.)",
  {},
  async () => {
    try { return ok(await query("home.getStats")); }
    catch (e) { return err(e); }
  }
);

// ─── Board Management ────────────────────────────────────────────────

server.tool(
  "list_boards",
  "List all boards visible to the current user",
  {},
  async () => {
    try { return ok(await query("board.getAllBoards")); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "get_board_by_name",
  "Get a board's full configuration by name (includes sections, items, layouts)",
  { name: z.string().describe("Board name") },
  async ({ name }) => {
    try { return ok(await query("board.getBoardByName", name)); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "get_home_board",
  "Get the user's home board",
  {},
  async () => {
    try { return ok(await query("board.getHomeBoard")); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "search_boards",
  "Search boards by name",
  {
    query: z.string().describe("Search query"),
    limit: z.number().min(1).max(100).default(10).optional().describe("Max results"),
  },
  async ({ query: q, limit }) => {
    try { return ok(await query("board.search", { query: q, limit: limit ?? 10 })); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "board_exists",
  "Check if a board name is already in use",
  { name: z.string().describe("Board name to check") },
  async ({ name }) => {
    try { return ok(await query("board.exists", name)); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "get_board_permissions",
  "Get permission configuration for a board",
  { id: z.string().describe("Board ID") },
  async ({ id }) => {
    try { return ok(await query("board.getBoardPermissions", { id })); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "rename_board",
  "Rename a board",
  {
    id: z.string().describe("Board ID"),
    name: z.string().describe("New board name"),
  },
  async ({ id, name }) => {
    try { return ok(await mutate("board.renameBoard", { id, name }) ?? { success: true }); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "create_board",
  "Create a new board",
  {
    name: z.string().describe("Board name (alphanumeric, dashes, underscores only)"),
    columnCount: z.number().min(1).max(24).describe("Number of grid columns"),
    isPublic: z.boolean().describe("Whether the board is publicly visible"),
  },
  async ({ name, columnCount, isPublic }) => {
    try { return ok(await mutate("board.createBoard", { name, columnCount, isPublic })); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "duplicate_board",
  "Duplicate an existing board with a new name",
  {
    id: z.string().describe("Board ID to duplicate"),
    name: z.string().describe("Name for the new board (alphanumeric, dashes, underscores only)"),
  },
  async ({ id, name }) => {
    try { return ok(await mutate("board.duplicateBoard", { id, name }) ?? { success: true }); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "delete_board",
  "Delete a board",
  { id: z.string().describe("Board ID") },
  async ({ id }) => {
    try { return ok(await mutate("board.deleteBoard", { id }) ?? { success: true }); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "change_board_visibility",
  "Change board visibility (public/private)",
  {
    id: z.string().describe("Board ID"),
    visibility: z.enum(["public", "private"]).describe("Board visibility"),
  },
  async ({ id, visibility }) => {
    try { return ok(await mutate("board.changeBoardVisibility", { id, visibility }) ?? { success: true }); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "save_board_settings",
  "Update board appearance/behavior settings (all fields optional)",
  {
    id: z.string().describe("Board ID"),
    pageTitle: z.string().optional().describe("Page title"),
    logoImageUrl: z.string().optional().describe("Logo image URL"),
    faviconImageUrl: z.string().optional().describe("Favicon image URL"),
    backgroundImageUrl: z.string().optional().describe("Background image URL"),
    backgroundImageAttachment: z.enum(["fixed", "scroll"]).optional().describe("Background attachment"),
    backgroundImageSize: z.enum(["cover", "contain"]).optional().describe("Background size"),
    primaryColor: z.string().optional().describe("Primary color (#RRGGBB)"),
    secondaryColor: z.string().optional().describe("Secondary color (#RRGGBB)"),
    opacity: z.number().min(0).max(100).optional().describe("Widget opacity (0-100)"),
    customCss: z.string().optional().describe("Custom CSS (max 16384 chars)"),
    itemRadius: z.enum(["xs", "sm", "md", "lg", "xl"]).optional().describe("Widget border radius"),
    disableStatus: z.boolean().optional().describe("Disable status indicators"),
  },
  async (params) => {
    try {
      const { id, ...settings } = params;
      // Remove undefined values
      const cleaned = Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined));
      return ok(await mutate("board.savePartialBoardSettings", { id, ...cleaned }) ?? { success: true });
    } catch (e) { return err(e); }
  }
);

server.tool(
  "save_board",
  "Save full board layout (sections and items). Use get_board_by_name first to get the current structure, modify it, then save.",
  {
    id: z.string().describe("Board ID"),
    sections: z.array(z.any()).describe("Array of section objects (category/empty/dynamic)"),
    items: z.array(z.any()).describe("Array of item objects (widgets with layouts and options)"),
  },
  async ({ id, sections, items }) => {
    try { return ok(await mutate("board.saveBoard", { id, sections, items }) ?? { success: true }); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "set_home_board",
  "Set a board as the home board",
  { id: z.string().describe("Board ID") },
  async ({ id }) => {
    try { return ok(await mutate("board.setHomeBoard", { id }) ?? { success: true }); }
    catch (e) { return err(e); }
  }
);

// ─── User Management ─────────────────────────────────────────────────

server.tool(
  "list_users",
  "List all Homarr users (admin only)",
  {},
  async () => {
    try { return ok(await query("user.getAll")); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "get_user",
  "Get user details by ID",
  { userId: z.string().describe("User ID") },
  async ({ userId }) => {
    try { return ok(await query("user.getById", { userId })); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "search_users",
  "Search users by name (admin only)",
  {
    query: z.string().describe("Search query"),
    limit: z.number().min(1).max(100).default(10).optional().describe("Max results"),
  },
  async ({ query: q, limit }) => {
    try { return ok(await query("user.search", { query: q, limit: limit ?? 10 })); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "create_user",
  "Create a new Homarr user (admin only)",
  {
    username: z.string().min(3).max(255).describe("Username (3-255 chars)"),
    password: z.string().min(8).describe("Password (min 8 chars, must have upper+lower+digit+special)"),
    confirmPassword: z.string().describe("Must match password"),
    email: z.string().optional().describe("Email address"),
    groupIds: z.array(z.string()).optional().describe("Group IDs to assign user to"),
  },
  async ({ username, password, confirmPassword, email, groupIds }) => {
    try {
      return ok(await mutate("user.create", {
        username,
        password,
        confirmPassword,
        email: email || undefined,
        groupIds: groupIds ?? [],
      }));
    } catch (e) { return err(e); }
  }
);

server.tool(
  "delete_user",
  "Delete a Homarr user",
  { userId: z.string().describe("User ID to delete") },
  async ({ userId }) => {
    try { return ok(await mutate("user.delete", { userId }) ?? { success: true }); }
    catch (e) { return err(e); }
  }
);

// ─── App Management ──────────────────────────────────────────────────

server.tool(
  "list_apps",
  "List all apps",
  {},
  async () => {
    try { return ok(await query("app.all")); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "search_apps",
  "Search apps by name",
  {
    query: z.string().describe("Search query"),
    limit: z.number().min(1).max(100).default(10).optional().describe("Max results"),
  },
  async ({ query: q, limit }) => {
    try { return ok(await query("app.search", { query: q, limit: limit ?? 10 })); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "get_app",
  "Get app details by ID",
  { id: z.string().describe("App ID") },
  async ({ id }) => {
    try { return ok(await query("app.byId", { id })); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "create_app",
  "Create a new app in Homarr",
  {
    name: z.string().min(1).max(64).describe("App name"),
    iconUrl: z.string().min(1).describe("Icon URL (use find_icons to discover available icons)"),
    href: z.string().optional().describe("App URL (must be a valid URL, no javascript:)"),
    pingUrl: z.string().optional().describe("Ping URL for status checks (http/https only)"),
    description: z.string().max(512).optional().describe("App description"),
  },
  async ({ name, iconUrl, href, pingUrl, description }) => {
    try {
      return ok(await mutate("app.create", {
        name,
        iconUrl,
        href: href || null,
        pingUrl: pingUrl || null,
        description: description || null,
      }));
    } catch (e) { return err(e); }
  }
);

server.tool(
  "create_apps_bulk",
  "Create multiple apps at once",
  {
    apps: z.array(z.object({
      name: z.string().min(1).max(64).describe("App name"),
      iconUrl: z.string().optional().describe("Icon URL"),
      href: z.string().optional().describe("App URL"),
      pingUrl: z.string().optional().describe("Ping URL"),
      description: z.string().max(512).optional().describe("Description"),
    })).min(1).describe("Array of apps to create"),
  },
  async ({ apps }) => {
    try {
      const cleaned = apps.map((a) => ({
        name: a.name,
        iconUrl: a.iconUrl || null,
        href: a.href || null,
        pingUrl: a.pingUrl || null,
        description: a.description || null,
      }));
      return ok(await mutate("app.createMany", cleaned));
    } catch (e) { return err(e); }
  }
);

server.tool(
  "update_app",
  "Update an existing app",
  {
    id: z.string().describe("App ID"),
    name: z.string().min(1).max(64).describe("App name"),
    iconUrl: z.string().min(1).describe("Icon URL"),
    href: z.string().optional().describe("App URL"),
    pingUrl: z.string().optional().describe("Ping URL"),
    description: z.string().max(512).optional().describe("Description"),
  },
  async ({ id, name, iconUrl, href, pingUrl, description }) => {
    try {
      return ok(await mutate("app.update", {
        id,
        name,
        iconUrl,
        href: href || null,
        pingUrl: pingUrl || null,
        description: description || null,
      }) ?? { success: true });
    } catch (e) { return err(e); }
  }
);

server.tool(
  "delete_app",
  "Delete an app",
  { id: z.string().describe("App ID") },
  async ({ id }) => {
    try { return ok(await mutate("app.delete", { id }) ?? { success: true }); }
    catch (e) { return err(e); }
  }
);

// ─── Integration Management ──────────────────────────────────────────

server.tool(
  "list_integrations",
  "List all integrations accessible to the current user",
  {},
  async () => {
    try { return ok(await query("integration.all")); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "get_integration",
  "Get integration details by ID (includes secrets)",
  { id: z.string().describe("Integration ID") },
  async ({ id }) => {
    try { return ok(await query("integration.byId", { id })); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "search_integrations",
  "Search integrations by name",
  {
    query: z.string().describe("Search query"),
    limit: z.number().min(1).max(100).default(10).optional().describe("Max results"),
  },
  async ({ query: q, limit }) => {
    try { return ok(await query("integration.search", { query: q, limit: limit ?? 10 })); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "create_integration",
  "Create a new integration (e.g. Sonarr, Radarr, Plex, Pi-hole, etc.)",
  {
    name: z.string().min(1).max(127).describe("Integration name"),
    kind: z.string().describe("Integration kind (e.g. sonarr, radarr, jellyfin, piHole, adGuardHome, etc.)"),
    url: z.string().describe("Integration URL (http/https)"),
    secrets: z.array(z.object({
      kind: z.string().describe("Secret kind (e.g. apiKey, username, password)"),
      value: z.string().describe("Secret value"),
    })).describe("Integration secrets/credentials"),
  },
  async ({ name, kind, url, secrets }) => {
    try {
      return ok(await mutate("integration.create", {
        name,
        kind,
        url,
        secrets,
        attemptSearchEngineCreation: false,
      }));
    } catch (e) { return err(e); }
  }
);

server.tool(
  "update_integration",
  "Update an existing integration",
  {
    id: z.string().describe("Integration ID"),
    name: z.string().min(1).max(127).describe("Integration name"),
    url: z.string().describe("Integration URL (http/https)"),
    secrets: z.array(z.object({
      kind: z.string().describe("Secret kind"),
      value: z.string().optional().describe("Secret value (null to keep existing)"),
    })).describe("Integration secrets"),
  },
  async ({ id, name, url, secrets }) => {
    try {
      return ok(await mutate("integration.update", { id, name, url, secrets }) ?? { success: true });
    } catch (e) { return err(e); }
  }
);

server.tool(
  "delete_integration",
  "Delete an integration",
  { id: z.string().describe("Integration ID") },
  async ({ id }) => {
    try { return ok(await mutate("integration.delete", { id }) ?? { success: true }); }
    catch (e) { return err(e); }
  }
);

// ─── Group Management ────────────────────────────────────────────────

server.tool(
  "list_groups",
  "List all groups with their members (admin only)",
  {},
  async () => {
    try { return ok(await query("group.getAll")); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "get_group",
  "Get group details by ID (admin only)",
  { id: z.string().describe("Group ID") },
  async ({ id }) => {
    try { return ok(await query("group.getById", { id })); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "create_group",
  "Create a new group (admin only)",
  { name: z.string().describe("Group name") },
  async ({ name }) => {
    try { return ok(await mutate("group.createGroup", { name })); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "delete_group",
  "Delete a group (admin only)",
  { id: z.string().describe("Group ID") },
  async ({ id }) => {
    try { return ok(await mutate("group.deleteGroup", { id }) ?? { success: true }); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "add_group_member",
  "Add a user to a group (admin only)",
  {
    groupId: z.string().describe("Group ID"),
    userId: z.string().describe("User ID to add"),
  },
  async ({ groupId, userId }) => {
    try { return ok(await mutate("group.addMember", { groupId, userId }) ?? { success: true }); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "remove_group_member",
  "Remove a user from a group (admin only)",
  {
    groupId: z.string().describe("Group ID"),
    userId: z.string().describe("User ID to remove"),
  },
  async ({ groupId, userId }) => {
    try { return ok(await mutate("group.removeMember", { groupId, userId }) ?? { success: true }); }
    catch (e) { return err(e); }
  }
);

// ─── Invite Management ───────────────────────────────────────────────

server.tool(
  "list_invites",
  "List all pending invites (admin only)",
  {},
  async () => {
    try { return ok(await query("invite.getAll")); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "create_invite",
  "Create an invitation link for a new user (admin only)",
  {
    expirationDate: z.string().describe("Expiration date in ISO 8601 format"),
  },
  async ({ expirationDate }) => {
    try { return ok(await mutate("invite.createInvite", { expirationDate: new Date(expirationDate).toISOString() })); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "delete_invite",
  "Delete an invitation (admin only)",
  { id: z.string().describe("Invite ID") },
  async ({ id }) => {
    try { return ok(await mutate("invite.deleteInvite", { id }) ?? { success: true }); }
    catch (e) { return err(e); }
  }
);

// ─── Docker Management ───────────────────────────────────────────────

server.tool(
  "list_containers",
  "List all Docker containers (admin only)",
  {},
  async () => {
    try { return ok(await query("docker.getContainers")); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "start_containers",
  "Start Docker containers by ID (admin only)",
  { ids: z.array(z.string()).describe("Container IDs to start") },
  async ({ ids }) => {
    try { return ok(await mutate("docker.startAll", { ids }) ?? { success: true }); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "stop_containers",
  "Stop Docker containers by ID (admin only)",
  { ids: z.array(z.string()).describe("Container IDs to stop") },
  async ({ ids }) => {
    try { return ok(await mutate("docker.stopAll", { ids }) ?? { success: true }); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "restart_containers",
  "Restart Docker containers by ID (admin only)",
  { ids: z.array(z.string()).describe("Container IDs to restart") },
  async ({ ids }) => {
    try { return ok(await mutate("docker.restartAll", { ids }) ?? { success: true }); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "remove_containers",
  "Remove Docker containers by ID (admin only)",
  { ids: z.array(z.string()).describe("Container IDs to remove") },
  async ({ ids }) => {
    try { return ok(await mutate("docker.removeAll", { ids }) ?? { success: true }); }
    catch (e) { return err(e); }
  }
);

// ─── Kubernetes ──────────────────────────────────────────────────────

server.tool(
  "k8s_cluster_info",
  "Get Kubernetes cluster info (version, metrics, capacity) — admin only",
  {},
  async () => {
    try { return ok(await query("kubernetes.cluster.getCluster")); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "k8s_resource_counts",
  "Get counts of Kubernetes resources (nodes, namespaces, pods, etc.) — admin only",
  {},
  async () => {
    try { return ok(await query("kubernetes.cluster.getClusterResourceCounts")); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "k8s_nodes",
  "Get Kubernetes node information with metrics — admin only",
  {},
  async () => {
    try { return ok(await query("kubernetes.nodes.getNodes")); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "k8s_pods",
  "Get all Kubernetes pods — admin only",
  {},
  async () => {
    try { return ok(await query("kubernetes.pods.getPods")); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "k8s_services",
  "Get Kubernetes services — admin only",
  {},
  async () => {
    try { return ok(await query("kubernetes.services.getServices")); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "k8s_namespaces",
  "Get all Kubernetes namespaces — admin only",
  {},
  async () => {
    try { return ok(await query("kubernetes.namespaces.getNamespaces")); }
    catch (e) { return err(e); }
  }
);

// ─── Icons ───────────────────────────────────────────────────────────

server.tool(
  "find_icons",
  "Search for icons from all configured icon repositories",
  {
    searchText: z.string().describe("Search text for icon lookup"),
    limitPerGroup: z.number().optional().describe("Max results per icon group"),
  },
  async ({ searchText, limitPerGroup }) => {
    try { return ok(await query("icon.findIcons", { searchText, limitPerGroup: limitPerGroup ?? 20 })); }
    catch (e) { return err(e); }
  }
);

// ─── Search Engines ──────────────────────────────────────────────────

server.tool(
  "list_search_engines",
  "List search engines configured in Homarr",
  {},
  async () => {
    try { return ok(await query("searchEngine.getSelectable")); }
    catch (e) { return err(e); }
  }
);

// ─── API Keys ────────────────────────────────────────────────────────

server.tool(
  "list_api_keys",
  "List all API keys (admin only)",
  {},
  async () => {
    try { return ok(await query("apiKeys.getAll")); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "create_api_key",
  "Create a new API key (admin only)",
  {},
  async () => {
    try { return ok(await mutate("apiKeys.create")); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "delete_api_key",
  "Delete an API key (admin only)",
  { id: z.string().describe("API key ID") },
  async ({ id }) => {
    try { return ok(await mutate("apiKeys.delete", { id }) ?? { success: true }); }
    catch (e) { return err(e); }
  }
);

// ─── Cron Jobs ───────────────────────────────────────────────────────

server.tool(
  "list_cron_jobs",
  "List all scheduled cron jobs (admin only)",
  {},
  async () => {
    try { return ok(await query("cronJobs.getJobs")); }
    catch (e) { return err(e); }
  }
);

server.tool(
  "trigger_cron_job",
  "Manually trigger a cron job (admin only)",
  { id: z.string().describe("Job ID") },
  async ({ id }) => {
    try { return ok(await mutate("cronJobs.triggerJob", { id }) ?? { success: true }); }
    catch (e) { return err(e); }
  }
);

// ─── Server Settings ─────────────────────────────────────────────────

server.tool(
  "get_server_settings",
  "Get all server settings (admin only)",
  {},
  async () => {
    try { return ok(await query("serverSettings.getAll")); }
    catch (e) { return err(e); }
  }
);

// ─── Location (Weather) ─────────────────────────────────────────────

server.tool(
  "search_city",
  "Search for a city by name (for weather widget setup)",
  { query: z.string().describe("City name to search") },
  async ({ query: q }) => {
    try { return ok(await query("location.searchCity", { query: q })); }
    catch (e) { return err(e); }
  }
);

// ─── Update Checker ──────────────────────────────────────────────────

server.tool(
  "check_updates",
  "Check for available Homarr updates (admin only)",
  {},
  async () => {
    try { return ok(await query("updateChecker.getAvailableUpdates")); }
    catch (e) { return err(e); }
  }
);

// ─── Media Management ────────────────────────────────────────────────

server.tool(
  "list_media",
  "List uploaded media files (paginated)",
  {
    page: z.number().optional().describe("Page number (default 0)"),
    pageSize: z.number().optional().describe("Items per page (default 20)"),
    search: z.string().optional().describe("Search query"),
  },
  async ({ page, pageSize, search }) => {
    try {
      return ok(await query("media.getPaginated", {
        page: page ?? 0,
        pageSize: pageSize ?? 20,
        search: search ?? "",
      }));
    } catch (e) { return err(e); }
  }
);

// ─── Start Server ────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Homarr MCP server running (${HOMARR_URL})`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

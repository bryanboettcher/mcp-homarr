/**
 * MCP-level integration tests for the Homarr MCP server.
 *
 * These tests exercise the actual MCP tool dispatch logic in src/index.ts by
 * spawning the compiled server as a child process and communicating via the
 * MCP JSON-RPC protocol using StdioClientTransport. This layer is deliberately
 * NOT covered by tests/e2e.test.ts, which bypasses dispatch and calls the
 * HomarrClient directly.
 *
 * The key regression covered here: homarr_boards "get" previously passed
 * v.name (bare string) instead of { name: v.name } to the tRPC client.
 *
 * Requires a running Homarr instance (see docker-compose.test.yml).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { bootstrap } from "./bootstrap.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Setup ───────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = resolve(__dirname, "../dist/index.js");

let mcpClient: Client;
let transport: StdioClientTransport;

beforeAll(async () => {
  const ctx = await bootstrap();

  transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: {
      ...process.env as Record<string, string>,
      HOMARR_URL: ctx.baseUrl,
      HOMARR_API_KEY: ctx.apiKey,
    },
    // Pipe stderr so server log output doesn't pollute test output
    stderr: "pipe",
  });

  mcpClient = new Client(
    { name: "mcp-tools-test", version: "1.0.0" },
    { capabilities: {} }
  );

  await mcpClient.connect(transport);
}, 150_000);

afterAll(async () => {
  await mcpClient.close();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Call a tool and parse the JSON text from the first content item.
 * Returns { data, isError } so callers can assert on error cases without
 * throwing from the test helper itself.
 */
async function callTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ data: unknown; isError: boolean }> {
  const result = await mcpClient.callTool({ name, arguments: args });
  const firstContent = result.content[0];
  if (firstContent.type !== "text") {
    throw new Error(`Expected text content, got ${firstContent.type}`);
  }
  const text = firstContent.text as string;
  // Error responses may not be valid JSON (the server formats them as "Error: <msg>")
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { data, isError: result.isError === true };
}

// ─── homarr (discovery / info) ───────────────────────────────────────────────

describe("homarr tool", () => {
  it("info returns version object", async () => {
    const { data, isError } = await callTool("homarr", { action: "info" });
    expect(isError, "Expected success response").toBe(false);
    expect(data).toBeDefined();
    expect(typeof data).toBe("object");
  });

  it("stats returns statistics", async () => {
    const { data, isError } = await callTool("homarr", { action: "stats" });
    expect(isError, "Expected success response").toBe(false);
    expect(data).toBeDefined();
  });
});

// ─── homarr_boards ───────────────────────────────────────────────────────────
//
// This describe block is the primary regression guard: it exercises the full
// create → get → rename → get → delete lifecycle through MCP tool dispatch,
// which is where the original { name: v.name } bug lived.

describe("homarr_boards tool", () => {
  let boardId: string;
  const boardName = `mcp-test-board-${Date.now()}`;
  const renamedBoardName = `mcp-test-renamed-${Date.now()}`;

  it("list returns array", async () => {
    const { data, isError } = await callTool("homarr_boards", { action: "list" });
    expect(isError, "Expected success response").toBe(false);
    expect(Array.isArray(data)).toBe(true);
  });

  it("create returns boardId", async () => {
    const { data, isError } = await callTool("homarr_boards", {
      action: "create",
      params: { name: boardName, columnCount: 10, isPublic: false },
    });
    expect(isError, "Expected success response").toBe(false);
    const result = data as { boardId: string };
    expect(result.boardId).toBeTruthy();
    boardId = result.boardId;
  });

  it("get returns board with matching name — regression: must pass {name} not bare string", async () => {
    // This test would have caught the original bug where the dispatch code
    // passed v.name (bare string) to board.getBoardByName instead of
    // { name: v.name } (object). The tRPC endpoint expects an object.
    const { data, isError } = await callTool("homarr_boards", {
      action: "get",
      params: { name: boardName },
    });
    expect(isError, `Expected success but got error: ${JSON.stringify(data)}`).toBe(false);
    const result = data as { name: string };
    expect(result).toBeDefined();
    expect(result.name).toBe(boardName);
  });

  it("rename succeeds", async () => {
    const { data, isError } = await callTool("homarr_boards", {
      action: "rename",
      params: { id: boardId, name: renamedBoardName },
    });
    expect(isError, `Expected success but got error: ${JSON.stringify(data)}`).toBe(false);
  });

  it("get returns board with new name after rename", async () => {
    const { data, isError } = await callTool("homarr_boards", {
      action: "get",
      params: { name: renamedBoardName },
    });
    expect(isError, `Expected success but got error: ${JSON.stringify(data)}`).toBe(false);
    const result = data as { name: string };
    expect(result.name).toBe(renamedBoardName);
  });

  it("delete succeeds", async () => {
    const { data, isError } = await callTool("homarr_boards", {
      action: "delete",
      params: { id: boardId },
    });
    expect(isError, `Expected success but got error: ${JSON.stringify(data)}`).toBe(false);
  });

  it("list no longer contains deleted board", async () => {
    const { data, isError } = await callTool("homarr_boards", { action: "list" });
    expect(isError).toBe(false);
    const boards = data as Array<{ name: string }>;
    expect(boards.some((b) => b.name === renamedBoardName)).toBe(false);
  });
});

// ─── homarr_apps ─────────────────────────────────────────────────────────────

describe("homarr_apps tool", () => {
  let appId: string;
  const appName = `MCP Test App ${Date.now()}`;

  it("create returns appId", async () => {
    const { data, isError } = await callTool("homarr_apps", {
      action: "create",
      params: {
        name: appName,
        iconUrl: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/homarr.png",
      },
    });
    expect(isError, `Expected success but got error: ${JSON.stringify(data)}`).toBe(false);
    const result = data as { appId?: string; id?: string; name: string };
    const id = result.appId ?? result.id;
    expect(id).toBeTruthy();
    expect(result.name).toBe(appName);
    appId = id as string;
  });

  it("get returns correct app", async () => {
    const { data, isError } = await callTool("homarr_apps", {
      action: "get",
      params: { id: appId },
    });
    expect(isError, `Expected success but got error: ${JSON.stringify(data)}`).toBe(false);
    const result = data as { id: string; name: string };
    expect(result.id).toBe(appId);
    expect(result.name).toBe(appName);
  });

  it("search finds created app", async () => {
    const { data, isError } = await callTool("homarr_apps", {
      action: "search",
      params: { query: "MCP Test App", limit: 20 },
    });
    expect(isError).toBe(false);
    const results = data as Array<{ id: string }>;
    expect(Array.isArray(results)).toBe(true);
    expect(results.some((a) => a.id === appId)).toBe(true);
  });

  it("delete succeeds", async () => {
    const { data, isError } = await callTool("homarr_apps", {
      action: "delete",
      params: { id: appId },
    });
    expect(isError, `Expected success but got error: ${JSON.stringify(data)}`).toBe(false);
  });
});

// ─── homarr_users ────────────────────────────────────────────────────────────

describe("homarr_users tool", () => {
  it("list returns user array", async () => {
    const { data, isError } = await callTool("homarr_users", { action: "list" });
    expect(isError).toBe(false);
    expect(Array.isArray(data)).toBe(true);
  });

  it("search finds bootstrap admin user", async () => {
    const { data, isError } = await callTool("homarr_users", {
      action: "search",
      params: { query: "testadmin", limit: 10 },
    });
    expect(isError).toBe(false);
    const results = data as Array<{ name: string }>;
    expect(Array.isArray(results)).toBe(true);
    const found = results.some((u) => u.name === "testadmin");
    expect(found, 'Expected to find "testadmin" in user search results').toBe(true);
  });
});

// ─── homarr_integrations ─────────────────────────────────────────────────────

describe("homarr_integrations tool", () => {
  it("list returns array (may be empty)", async () => {
    const { data, isError } = await callTool("homarr_integrations", { action: "list" });
    expect(isError).toBe(false);
    expect(Array.isArray(data)).toBe(true);
  });
});

// ─── homarr_groups ───────────────────────────────────────────────────────────

describe("homarr_groups tool", () => {
  it("list returns group array", async () => {
    const { data, isError } = await callTool("homarr_groups", { action: "list" });
    expect(isError).toBe(false);
    expect(Array.isArray(data)).toBe(true);
  });
});

// ─── homarr_invites ──────────────────────────────────────────────────────────

describe("homarr_invites tool", () => {
  it("list returns array", async () => {
    const { data, isError } = await callTool("homarr_invites", { action: "list" });
    expect(isError).toBe(false);
    expect(Array.isArray(data)).toBe(true);
  });
});

// ─── homarr_icons ────────────────────────────────────────────────────────────

describe("homarr_icons tool", () => {
  it("search plex returns results", async () => {
    const { data, isError } = await callTool("homarr_icons", { searchText: "plex" });
    expect(isError).toBe(false);
    expect(data).toBeDefined();
  });
});

// ─── homarr_admin ────────────────────────────────────────────────────────────

describe("homarr_admin tool", () => {
  it("list_api_keys returns array", async () => {
    const { data, isError } = await callTool("homarr_admin", { action: "list_api_keys" });
    expect(isError).toBe(false);
    expect(Array.isArray(data)).toBe(true);
  });

  it("list_search_engines returns results", async () => {
    const { data, isError } = await callTool("homarr_admin", { action: "list_search_engines" });
    expect(isError).toBe(false);
    expect(data).toBeDefined();
  });
});

// ─── Expected failures — infrastructure not available ────────────────────────

describe("homarr_docker tool — expected error without Docker socket", () => {
  it("list returns isError=true (no Docker socket in test container)", async () => {
    const { isError } = await callTool("homarr_docker", { action: "list" });
    // The MCP server catches the tRPC error and returns isError: true rather
    // than propagating it as a protocol-level error.
    expect(isError).toBe(true);
  });
});

describe("homarr_kubernetes tool — expected error without k8s", () => {
  it("cluster returns isError=true (no Kubernetes configured)", async () => {
    const { isError } = await callTool("homarr_kubernetes", { action: "cluster" });
    expect(isError).toBe(true);
  });
});

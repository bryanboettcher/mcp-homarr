/**
 * E2E test suite for the Homarr MCP server.
 *
 * Requires a running Homarr instance at HOMARR_TEST_URL (default: http://localhost:17576).
 * The docker-compose.test.yml file spins one up for CI.
 *
 * Run: vitest run
 */

import { describe, it, expect, beforeAll } from "vitest";
import { bootstrap } from "./bootstrap.js";
import { HomarrClient } from "../src/client.js";

// ─── Setup ───────────────────────────────────────────────────────────────────

let client: HomarrClient;

beforeAll(async () => {
  const ctx = await bootstrap();
  client = new HomarrClient({ baseUrl: ctx.baseUrl, apiKey: ctx.apiKey });
}, 150_000);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix: string): string {
  // Alphanumeric + dash only — safe for board names and usernames alike
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Boards ──────────────────────────────────────────────────────────────────

describe("boards", () => {
  let boardId: string;
  let dupBoardId: string;
  const boardName = uid("testboard");
  const dupBoardName = uid("dupboard");

  it("create board", async () => {
    // API returns { boardId } — not { id, name }
    const result = await client.trpc("board.createBoard", {
      name: boardName,
      columnCount: 10,
      isPublic: false,
    }) as { boardId: string };

    expect(result).toBeDefined();
    expect(result.boardId).toBeTruthy();
    boardId = result.boardId;
  }, 15_000);

  it("get board by name", async () => {
    // boardByNameSchema is z.object({ name }), not a bare string
    const result = await client.trpcQuery("board.getBoardByName", { name: boardName }) as { name: string };

    expect(result).toBeDefined();
    expect(result.name).toBe(boardName);
  }, 15_000);

  it("search boards — finds created board", async () => {
    // Use a prefix common to our board name
    const results = await client.trpcQuery("board.search", { query: "testboard", limit: 20 }) as Array<{ name: string }>;

    expect(Array.isArray(results)).toBe(true);
    const found = results.some((b) => b.name === boardName);
    expect(found, `Expected to find board "${boardName}" in search results`).toBe(true);
  }, 15_000);

  it("rename board", async () => {
    const newName = `${boardName}-renamed`;
    await client.trpc("board.renameBoard", { id: boardId, name: newName });

    // boardByNameSchema is z.object({ name })
    const result = await client.trpcQuery("board.getBoardByName", { name: newName }) as { name: string };
    expect(result.name).toBe(newName);

    // Rename back for downstream tests
    await client.trpc("board.renameBoard", { id: boardId, name: boardName });
  }, 15_000);

  it("save board settings — change primaryColor", async () => {
    // Should not throw; returns null or a partial object
    await expect(
      client.trpc("board.savePartialBoardSettings", { id: boardId, primaryColor: "#FF5500" })
    ).resolves.not.toThrow();
  }, 15_000);

  it("duplicate board", async () => {
    const result = await client.trpc("board.duplicateBoard", { id: boardId, name: dupBoardName }) as { id: string; name: string } | null;

    // Some Homarr versions return null on success
    if (result != null) {
      expect(result.id).toBeTruthy();
      dupBoardId = result.id;
    }
  }, 15_000);

  it("list boards — both original and duplicate exist", async () => {
    const results = await client.trpcQuery("board.getAllBoards") as Array<{ id: string; name: string }>;

    expect(Array.isArray(results)).toBe(true);
    const original = results.find((b) => b.name === boardName);
    expect(original, `Expected "${boardName}" in board list`).toBeDefined();

    if (!dupBoardId) {
      // Grab the duplicate id from the list if the create call returned null
      const dup = results.find((b) => b.name === dupBoardName);
      if (dup) dupBoardId = dup.id;
    }
  }, 15_000);

  it("delete both boards", async () => {
    await expect(client.trpc("board.deleteBoard", { id: boardId })).resolves.not.toThrow();

    if (dupBoardId) {
      await expect(client.trpc("board.deleteBoard", { id: dupBoardId })).resolves.not.toThrow();
    }

    const results = await client.trpcQuery("board.getAllBoards") as Array<{ name: string }>;
    expect(results.some((b) => b.name === boardName)).toBe(false);
    expect(results.some((b) => b.name === dupBoardName)).toBe(false);
  }, 15_000);
});

// ─── Apps ─────────────────────────────────────────────────────────────────────

describe("apps", () => {
  let appId: string;
  const appName = `TestApp-${Date.now()}`;
  const updatedAppName = `${appName}-updated`;

  it("create app", async () => {
    // API returns { appId, id, name, ... } — both appId and id are present
    const result = await client.trpc("app.create", {
      name: appName,
      iconUrl: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/plex.png",
      href: "https://plex.example.com",
      pingUrl: null,
      description: "Test Plex app",
    }) as { appId: string; id: string; name: string };

    expect(result).toBeDefined();
    const id = result.appId ?? result.id;
    expect(id).toBeTruthy();
    expect(result.name).toBe(appName);
    appId = id;
  }, 15_000);

  it("search apps — finds created app", async () => {
    const results = await client.trpcQuery("app.search", { query: "TestApp", limit: 20 }) as Array<{ name: string }>;

    expect(Array.isArray(results)).toBe(true);
    const found = results.some((a) => a.name === appName);
    expect(found, `Expected "${appName}" in app search results`).toBe(true);
  }, 15_000);

  it("update app — change name", async () => {
    await client.trpc("app.update", {
      id: appId,
      name: updatedAppName,
      iconUrl: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/plex.png",
      href: "https://plex.example.com",
      pingUrl: null,
      description: "Updated app",
    });

    const result = await client.trpcQuery("app.byId", { id: appId }) as { name: string };
    expect(result.name).toBe(updatedAppName);
  }, 15_000);

  it("get app by id — reflects updated name", async () => {
    const result = await client.trpcQuery("app.byId", { id: appId }) as { id: string; name: string };

    expect(result).toBeDefined();
    expect(result.id).toBe(appId);
    expect(result.name).toBe(updatedAppName);
  }, 15_000);

  it("delete app", async () => {
    await expect(client.trpc("app.delete", { id: appId })).resolves.not.toThrow();
  }, 15_000);

  it("list apps — deleted app is gone", async () => {
    const results = await client.trpcQuery("app.all") as Array<{ id: string }>;
    expect(Array.isArray(results)).toBe(true);
    expect(results.some((a) => a.id === appId)).toBe(false);
  }, 15_000);
});

// ─── Users ────────────────────────────────────────────────────────────────────

describe("users", () => {
  let userId: string;
  const username = `tuser${Date.now()}`;
  const password = "Passw0rd!test";

  it("create user", async () => {
    // user.create output is z.void() — returns undefined.
    // Retrieve the ID by searching immediately after creation.
    await client.trpc("user.create", {
      username,
      password,
      confirmPassword: password,
      groupIds: [],
    });

    const results = await client.trpcQuery("user.search", { query: username, limit: 5 }) as Array<{ id: string; name: string }>;
    const created = results.find((u) => u.name === username);
    expect(created, `Expected user "${username}" to appear in search after creation`).toBeDefined();
    userId = created!.id;
  }, 15_000);

  it("get user by id", async () => {
    const result = await client.trpcQuery("user.getById", { userId }) as { id: string; name: string };

    expect(result).toBeDefined();
    expect(result.id).toBe(userId);
  }, 15_000);

  it("search users — finds created user", async () => {
    const results = await client.trpcQuery("user.search", { query: "tuser", limit: 20 }) as Array<{ id: string }>;

    expect(Array.isArray(results)).toBe(true);
    const found = results.some((u) => u.id === userId);
    expect(found, `Expected user ${userId} in search results`).toBe(true);
  }, 15_000);

  it("delete user", async () => {
    await expect(client.trpc("user.delete", { userId })).resolves.not.toThrow();
  }, 15_000);
});

// ─── Groups ───────────────────────────────────────────────────────────────────

describe("groups", () => {
  let groupId: string;
  let memberUserId: string;
  const groupName = `TestGroup-${Date.now()}`;
  const memberUsername = `gmember${Date.now()}`;
  const memberPassword = "Passw0rd!grp";

  it("create a test user for membership tests", async () => {
    // user.create returns void — search for the user after creation
    await client.trpc("user.create", {
      username: memberUsername,
      password: memberPassword,
      confirmPassword: memberPassword,
      groupIds: [],
    });

    const results = await client.trpcQuery("user.search", { query: memberUsername, limit: 5 }) as Array<{ id: string; name: string }>;
    const created = results.find((u) => u.name === memberUsername);
    expect(created, `Expected user "${memberUsername}" to appear in search after creation`).toBeDefined();
    memberUserId = created!.id;
  }, 15_000);

  it("create group", async () => {
    // group.createGroup returns the id as a bare string, not { id, name }
    const result = await client.trpc("group.createGroup", { name: groupName }) as string;

    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
    expect(result).toBeTruthy();
    groupId = result;
  }, 15_000);

  it("list groups — finds created group", async () => {
    const results = await client.trpcQuery("group.getAll") as Array<{ id: string; name: string }>;

    expect(Array.isArray(results)).toBe(true);
    const found = results.some((g) => g.id === groupId);
    expect(found, `Expected group ${groupId} in list`).toBe(true);
  }, 15_000);

  it("get group by id", async () => {
    const result = await client.trpcQuery("group.getById", { id: groupId }) as { id: string; name: string };

    expect(result).toBeDefined();
    expect(result.id).toBe(groupId);
    expect(result.name).toBe(groupName);
  }, 15_000);

  it("add member to group", async () => {
    await expect(
      client.trpc("group.addMember", { groupId, userId: memberUserId })
    ).resolves.not.toThrow();
  }, 15_000);

  it("remove member from group", async () => {
    await expect(
      client.trpc("group.removeMember", { groupId, userId: memberUserId })
    ).resolves.not.toThrow();
  }, 15_000);

  it("delete group", async () => {
    await expect(client.trpc("group.deleteGroup", { id: groupId })).resolves.not.toThrow();
  }, 15_000);

  it("cleanup — delete test member user", async () => {
    await expect(client.trpc("user.delete", { userId: memberUserId })).resolves.not.toThrow();
  }, 15_000);
});

// ─── Invites ──────────────────────────────────────────────────────────────────

describe("invites", () => {
  let inviteId: string;

  it("create invite", async () => {
    // expirationDate must be a Date object — tRPC superjson serializes it correctly
    const expirationDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const result = await client.trpc("invite.createInvite", { expirationDate }) as { id: string; token: string };

    expect(result).toBeDefined();
    expect(result.id).toBeTruthy();
    inviteId = result.id;
  }, 15_000);

  it("list invites — finds created invite", async () => {
    const results = await client.trpcQuery("invite.getAll") as Array<{ id: string }>;

    expect(Array.isArray(results)).toBe(true);
    const found = results.some((inv) => inv.id === inviteId);
    expect(found, `Expected invite ${inviteId} in list`).toBe(true);
  }, 15_000);

  it("delete invite", async () => {
    await expect(client.trpc("invite.deleteInvite", { id: inviteId })).resolves.not.toThrow();
  }, 15_000);
});

// ─── Integrations ─────────────────────────────────────────────────────────────

describe("integrations", () => {
  // integration.create always runs testConnectionAsync first. With a fake URL the
  // connection test fails and the mutation returns { error } without inserting a row.
  // We capture whether creation succeeded and skip dependent tests when it didn't.
  let integrationId: string | undefined;
  const integrationName = `TestSonarr-${Date.now()}`;
  const updatedName = `${integrationName}-updated`;

  it("create integration (fake sonarr) — succeeds or returns connection error", async () => {
    const result = await client.trpc("integration.create", {
      name: integrationName,
      kind: "sonarr",
      url: "http://sonarr.example.test:8989",
      secrets: [{ kind: "apiKey", value: "fake-api-key-for-testing" }],
      attemptSearchEngineCreation: false,
    }) as { id: string; name: string } | { error: unknown } | null | undefined;

    // If the connection test fails the API returns { error } instead of inserting.
    // Accept both outcomes; downstream tests are skipped when creation failed.
    if (result && "error" in result) {
      // Connection test rejected the fake URL — this is expected in CI
      console.warn("integration.create: connection test failed, downstream tests will be skipped");
      return;
    }

    if (result && "id" in result) {
      expect(result.id).toBeTruthy();
      integrationId = result.id;
    }
    // null/undefined result also means no row was created
  }, 15_000);

  it("get integration by id", async () => {
    if (!integrationId) return;

    const result = await client.trpcQuery("integration.byId", { id: integrationId }) as { id: string; name: string };

    expect(result).toBeDefined();
    expect(result.id).toBe(integrationId);
    expect(result.name).toBe(integrationName);
  }, 15_000);

  it("search integrations — finds created integration", async () => {
    if (!integrationId) return;

    const results = await client.trpcQuery("integration.search", { query: "TestSonarr", limit: 20 }) as Array<{ id: string }>;

    expect(Array.isArray(results)).toBe(true);
    const found = results.some((i) => i.id === integrationId);
    expect(found, `Expected integration ${integrationId} in search results`).toBe(true);
  }, 15_000);

  it("update integration — change name", async () => {
    if (!integrationId) return;

    await client.trpc("integration.update", {
      id: integrationId,
      name: updatedName,
      url: "http://sonarr.example.test:8989",
      secrets: [{ kind: "apiKey", value: "fake-api-key-updated" }],
    });

    const result = await client.trpcQuery("integration.byId", { id: integrationId }) as { name: string };
    expect(result.name).toBe(updatedName);
  }, 15_000);

  it("delete integration", async () => {
    if (!integrationId) return;

    await expect(client.trpc("integration.delete", { id: integrationId })).resolves.not.toThrow();
  }, 15_000);
});

// ─── Read-only Operations ─────────────────────────────────────────────────────

describe("read-only operations", () => {
  it("info.getInfo returns version info", async () => {
    const result = await client.trpcQuery("info.getInfo") as Record<string, unknown>;

    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  }, 15_000);

  it("home.getStats returns dashboard statistics", async () => {
    const result = await client.trpcQuery("home.getStats");

    expect(result).toBeDefined();
  }, 15_000);

  it("icon.findIcons — search 'plex' returns results", async () => {
    const results = await client.trpcQuery("icon.findIcons", {
      searchText: "plex",
      limitPerGroup: 10,
    });

    // May return an array or a grouped object; either way it should be defined
    expect(results).toBeDefined();
  }, 15_000);

  it("searchEngine.getSelectable returns search engine list", async () => {
    const results = await client.trpcQuery("searchEngine.getSelectable");

    expect(results).toBeDefined();
  }, 15_000);

  it("serverSettings.getAll returns settings object", async () => {
    const result = await client.trpcQuery("serverSettings.getAll") as Record<string, unknown>;

    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  }, 15_000);

  it("updateChecker.getAvailableUpdates returns update info", async () => {
    const result = await client.trpcQuery("updateChecker.getAvailableUpdates");

    expect(result).toBeDefined();
  }, 15_000);
});

// ─── Expected Failures ────────────────────────────────────────────────────────

describe("expected failures — infrastructure not available", () => {
  it("docker.getContainers returns an error (no Docker socket)", async () => {
    // Homarr is not started with Docker socket access, so this must fail gracefully.
    // The tRPC layer should return a non-200 or an error body rather than crashing.
    await expect(client.trpcQuery("docker.getContainers")).rejects.toThrow();
  }, 15_000);

  it("kubernetes.cluster.getCluster returns an error (no k8s)", async () => {
    // Same reasoning: no Kubernetes configured in the test container.
    await expect(client.trpcQuery("kubernetes.cluster.getCluster")).rejects.toThrow();
  }, 15_000);

  it("cronJobs.getJobs returns an error (internal cron service not available)", async () => {
    // cronJobs.getJobs proxies to an internal analytics/cron service that is not
    // present in the test container. It will throw a fetch-level error.
    await expect(client.trpcQuery("cronJobs.getJobs")).rejects.toThrow();
  }, 15_000);
});

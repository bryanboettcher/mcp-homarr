/**
 * Bootstrap a fresh Homarr test instance:
 * 1. Wait for the container to be healthy
 * 2. Walk through onboarding (start → user → finish)
 * 3. Authenticate and create an API key
 * 4. Return the API key for test use
 */

const BASE_URL = process.env.HOMARR_TEST_URL ?? "http://localhost:17576";
const OWNER_NAME = "testadmin";
const OWNER_PASSWORD = "TestAdmin123!";

async function waitForHealthy(maxWaitMs = 120_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`${BASE_URL}/api/auth/csrf`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Homarr not healthy after ${maxWaitMs}ms at ${BASE_URL}`);
}

async function trpcPost(procedure: string, input: unknown): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/trpc/${procedure}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: input }),
  });
  const data = await res.json() as any;
  if (!res.ok && !data?.result) {
    throw new Error(`tRPC ${procedure} failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data?.result?.data?.json;
}

async function trpcGet(procedure: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/trpc/${procedure}`);
  const data = await res.json() as any;
  return data?.result?.data?.json;
}

async function completeOnboarding(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const step = await trpcGet("onboard.currentStep");
    const current = step?.current ?? step;

    if (current === "finish" || current === null) break;

    // At the "user" step, create the owner account
    if (current === "user") {
      await trpcPost("user.initUser", {
        username: OWNER_NAME,
        password: OWNER_PASSWORD,
        confirmPassword: OWNER_PASSWORD,
      });
    }

    // Advance to next step
    await trpcPost("onboard.nextStep", {});
  }
}

async function getSessionCookie(): Promise<string> {
  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const rawCookies = (csrfRes.headers as any).getSetCookie?.() as string[] | undefined;
  const csrfCookies = rawCookies
    ? rawCookies.map((c: string) => c.split(";")[0]).join("; ")
    : (csrfRes.headers.get("set-cookie") ?? "");

  const loginRes = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: csrfCookies,
    },
    body: new URLSearchParams({
      name: OWNER_NAME,
      password: OWNER_PASSWORD,
      csrfToken,
    }).toString(),
    redirect: "manual",
  });

  const loginCookies = ((loginRes.headers as any).getSetCookie?.() ?? []) as string[];
  for (const cookie of loginCookies) {
    const val = cookie.split(";")[0];
    if (val.includes("session-token=")) {
      return val;
    }
  }
  throw new Error(`Login failed: no session cookie (status ${loginRes.status})`);
}

async function createApiKey(sessionCookie: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/trpc/apiKeys.create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: sessionCookie,
    },
    body: JSON.stringify({ json: {} }),
  });

  if (!res.ok) {
    throw new Error(`Failed to create API key: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as any;
  return data.result.data.json.apiKey;
}

export interface TestContext {
  baseUrl: string;
  apiKey: string;
}

let _cached: TestContext | null = null;

export async function bootstrap(): Promise<TestContext> {
  if (_cached) return _cached;

  console.log("Waiting for Homarr to be healthy...");
  await waitForHealthy();

  console.log("Completing onboarding (creating owner)...");
  await completeOnboarding();

  console.log("Authenticating...");
  const cookie = await getSessionCookie();

  console.log("Creating API key...");
  const apiKey = await createApiKey(cookie);

  _cached = { baseUrl: BASE_URL, apiKey };
  console.log("Bootstrap complete.");
  return _cached;
}

/**
 * Homarr API client supporting two auth modes:
 *
 * 1. API Key (preferred): Set HOMARR_API_KEY. Sends "ApiKey" header on every request.
 *    No login flow needed. Works through reverse proxies.
 *
 * 2. Session cookie (fallback): Set HOMARR_USERNAME + HOMARR_PASSWORD.
 *    Performs credentials login via NextAuth/Auth.js to obtain a session cookie.
 *    Requires direct access to Homarr (won't work behind auth proxies like Authelia).
 */

export interface HomarrClientConfig {
  baseUrl: string;
  apiKey?: string;
  username?: string;
  password?: string;
}

export class HomarrClient {
  private baseUrl: string;
  private apiKey: string | null;
  private username: string;
  private password: string;
  private sessionCookie: string | null = null;
  private sessionExpiry: number = 0;

  constructor(config: HomarrClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey ?? null;
    this.username = config.username ?? "";
    this.password = config.password ?? "";

    if (!this.apiKey && (!this.username || !this.password)) {
      throw new Error("Either HOMARR_API_KEY or both HOMARR_USERNAME and HOMARR_PASSWORD are required");
    }
  }

  private authHeaders(): Record<string, string> {
    if (this.apiKey) {
      return { ApiKey: this.apiKey };
    }
    if (this.sessionCookie) {
      return { Cookie: this.sessionCookie };
    }
    return {};
  }

  private async authenticate(): Promise<void> {
    // API key auth needs no login flow
    if (this.apiKey) return;

    // Step 1: Get CSRF token
    const csrfRes = await fetch(`${this.baseUrl}/api/auth/csrf`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!csrfRes.ok) {
      throw new Error(`Failed to get CSRF token: ${csrfRes.status} ${csrfRes.statusText}`);
    }
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

    // Collect cookies from the CSRF response (must be forwarded for CSRF validation)
    const csrfCookies = this.extractSetCookieValues(csrfRes);

    // Step 2: Login with credentials (field is "name", not "username")
    const loginRes = await fetch(`${this.baseUrl}/api/auth/callback/credentials`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: csrfCookies,
      },
      body: new URLSearchParams({
        name: this.username,
        password: this.password,
        csrfToken,
      }).toString(),
      redirect: "manual",
    });

    // Extract session cookie — name varies by Homarr version
    const loginCookies = this.extractSetCookieValues(loginRes);
    const cookiePatterns = [
      /authjs\.session-token=[^;]+/,
      /next-auth\.session-token=[^;]+/,
      /__Secure-authjs\.session-token=[^;]+/,
      /__Secure-next-auth\.session-token=[^;]+/,
    ];

    let matched = false;
    for (const pattern of cookiePatterns) {
      const m = loginCookies.match(pattern);
      if (m) {
        this.sessionCookie = m[0];
        matched = true;
        break;
      }
    }

    if (!matched) {
      throw new Error(
        `Authentication failed: no session cookie received (status ${loginRes.status}). ` +
        `Check credentials and ensure Homarr is directly accessible at ${this.baseUrl}`
      );
    }

    this.sessionExpiry = Date.now() + 55 * 60 * 1000;
  }

  private extractSetCookieValues(res: Response): string {
    const raw = (res.headers as any).getSetCookie?.() as string[] | undefined;
    if (raw && raw.length > 0) {
      return raw.map((c) => c.split(";")[0]).join("; ");
    }
    return res.headers.get("set-cookie") ?? "";
  }

  private async ensureAuthenticated(): Promise<void> {
    if (this.apiKey) return; // always ready
    if (!this.sessionCookie || Date.now() > this.sessionExpiry) {
      await this.authenticate();
    }
  }

  /**
   * Call a tRPC mutation (POST).
   */
  async trpc(procedure: string, input?: unknown): Promise<unknown> {
    await this.ensureAuthenticated();

    const url = `${this.baseUrl}/api/trpc/${procedure}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...this.authHeaders(),
    };

    const body = input !== undefined ? { json: input } : { json: {} };

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "manual",
    });

    if ((res.status === 302 || res.status === 401) && !this.apiKey) {
      this.sessionCookie = null;
      await this.ensureAuthenticated();
      return this.trpc(procedure, input);
    }

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Homarr tRPC error ${res.status} on ${procedure}: ${text}`);
    }

    return this.unwrapTrpc(text);
  }

  /**
   * Call a tRPC query (GET).
   */
  async trpcQuery(procedure: string, input?: unknown): Promise<unknown> {
    await this.ensureAuthenticated();

    let url = `${this.baseUrl}/api/trpc/${procedure}`;
    if (input !== undefined) {
      const encoded = encodeURIComponent(JSON.stringify({ json: input }));
      url += `?input=${encoded}`;
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...this.authHeaders(),
    };

    const res = await fetch(url, {
      method: "GET",
      headers,
      redirect: "manual",
    });

    if ((res.status === 302 || res.status === 401) && !this.apiKey) {
      this.sessionCookie = null;
      await this.ensureAuthenticated();
      return this.trpcQuery(procedure, input);
    }

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Homarr tRPC query error ${res.status} on ${procedure}: ${text}`);
    }

    return this.unwrapTrpc(text);
  }

  private unwrapTrpc(text: string): unknown {
    try {
      const parsed = JSON.parse(text);
      if (parsed?.result?.data?.json !== undefined) {
        return parsed.result.data.json;
      }
      if (parsed?.result?.data !== undefined) {
        return parsed.result.data;
      }
      return parsed;
    } catch {
      return text;
    }
  }
}

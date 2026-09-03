/**
 * A tiny cookie-keeping HTTP session.
 *
 * The Python client gets this for free from `requests.Session`. The KRÉTA
 * login flow genuinely needs it: the IDP sets an anti-forgery cookie on the
 * `/connect/authorize` page and refuses the credential POST without it, and
 * the post-login `ReturnUrl` hop needs the session cookie the POST set. Node
 * `fetch` keeps no cookies and, when it follows redirects itself, hides the
 * intermediate `Set-Cookie` headers — so redirects are followed here by hand.
 */
import { HTTP_TIMEOUT_MS } from "./constants.js";

const MAX_REDIRECTS = 10;

export interface SessionResponse {
  status: number;
  url: string;
  headers: Headers;
  body: string;
}

export class HttpSession {
  private readonly cookies = new Map<string, string>();
  private readonly fetchImpl: typeof fetch;

  /** `fetchImpl` is injectable so tests can drive the flow without a network. */
  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  private storeCookies(response: Response): void {
    // getSetCookie() keeps multiple Set-Cookie headers separate; a plain
    // get() would join them and corrupt values containing a comma.
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(";", 1)[0] ?? "";
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === "" || /^deleted$/i.test(value)) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  private cookieHeader(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  /** One request, redirects NOT followed. */
  async request(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<SessionResponse> {
    const headers: Record<string, string> = { ...init.headers };
    const cookie = this.cookieHeader();
    if (cookie) headers["cookie"] = cookie;

    const response = await this.fetchImpl(url, {
      method: init.method ?? "GET",
      headers,
      body: init.body,
      redirect: "manual",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    this.storeCookies(response);
    return {
      status: response.status,
      url,
      headers: response.headers,
      body: await response.text(),
    };
  }

  /** Follows redirects by hand, keeping every hop's cookies. */
  async follow(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<SessionResponse> {
    let current = url;
    let response = await this.request(current, init);
    for (let hop = 0; hop < MAX_REDIRECTS; hop += 1) {
      if (response.status < 300 || response.status >= 400) return response;
      const location = response.headers.get("location");
      if (!location) return response;
      current = new URL(location, current).toString();
      // A redirect after a POST is followed as a GET, per RFC 9110 §15.4.
      response = await this.request(current, { headers: init.headers });
    }
    return response;
  }
}

import { ProxyAgent } from "undici";

export type AccountProxyConfig = {
  protocol: "http" | "https";
  host: string;
  port: number;
  username?: string;
  password?: string;
};

type PublishRequest = {
  accessToken: string;
  text: string;
  proxy?: AccountProxyConfig;
};

export type XRateLimit = {
  limit: number | null;
  remaining: number | null;
  resetAt: Date | null;
};

export type XPublishResult = {
  ok: boolean;
  postId?: string;
  status: number;
  errorCode?: string;
  errorMessage?: string;
  rateLimit: XRateLimit;
};

export type XRefreshResult =
  | {
      ok: true;
      accessToken: string;
      refreshToken: string | null;
      expiresAt: Date | null;
    }
  | {
      ok: false;
      status: number;
      errorMessage: string;
    };

const proxyDispatcherCache = new Map<string, ProxyAgent>();

function encodeProxyCredentials(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

function buildProxyUrl(config: AccountProxyConfig): string {
  const credentials =
    config.username && config.password
      ? `${encodeProxyCredentials(config.username)}:${encodeProxyCredentials(config.password)}@`
      : config.username
        ? `${encodeProxyCredentials(config.username)}@`
        : "";
  return `${config.protocol}://${credentials}${config.host}:${config.port}`;
}

function proxyCacheKey(config?: AccountProxyConfig): string {
  if (!config) {
    return "";
  }
  return [
    config.protocol,
    config.host,
    String(config.port),
    config.username ?? "",
    config.password ?? ""
  ].join("|");
}

function getProxyDispatcher(config?: AccountProxyConfig): ProxyAgent | undefined {
  if (!config) {
    return undefined;
  }
  const key = proxyCacheKey(config);
  const cached = proxyDispatcherCache.get(key);
  if (cached) {
    return cached;
  }
  const dispatcher = new ProxyAgent(buildProxyUrl(config));
  proxyDispatcherCache.set(key, dispatcher);
  return dispatcher;
}

function parseRateLimit(headers: Headers): XRateLimit {
  const limitRaw = headers.get("x-rate-limit-limit");
  const remainingRaw = headers.get("x-rate-limit-remaining");
  const resetRaw = headers.get("x-rate-limit-reset");
  const limit = limitRaw ? Number(limitRaw) : null;
  const remaining = remainingRaw ? Number(remainingRaw) : null;
  const resetEpoch = resetRaw ? Number(resetRaw) : NaN;
  return {
    limit: Number.isFinite(limit) ? limit : null,
    remaining: Number.isFinite(remaining) ? remaining : null,
    resetAt: Number.isFinite(resetEpoch) ? new Date(resetEpoch * 1000) : null
  };
}

function parseErrorMessage(payload: unknown): { errorCode?: string; errorMessage?: string } {
  if (!payload || typeof payload !== "object") {
    return {};
  }
  const source = payload as {
    error?: string;
    message?: string;
    detail?: string;
    title?: string;
    errors?: Array<{ message?: string }>;
  };
  const nested = Array.isArray(source.errors) ? source.errors.find((x) => x?.message)?.message : undefined;
  const errorMessage = source.message ?? source.detail ?? source.title ?? nested;
  return {
    errorCode: source.error,
    errorMessage
  };
}

export async function publishPostToX(input: PublishRequest): Promise<XPublishResult> {
  if (process.env.MOCK_X_API === "1") {
    return {
      ok: true,
      postId: `mock_${Date.now()}`,
      status: 200,
      rateLimit: {
        limit: 300,
        remaining: 299,
        resetAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    };
  }

  const requestInit: RequestInit & { dispatcher?: ProxyAgent } = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text: input.text
    }),
    cache: "no-store"
  };
  const dispatcher = getProxyDispatcher(input.proxy);
  if (dispatcher) {
    requestInit.dispatcher = dispatcher;
  }
  const response = await fetch("https://api.x.com/2/tweets", requestInit);

  const rateLimit = parseRateLimit(response.headers);

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const parsed = parseErrorMessage(payload);
    return {
      ok: false,
      status: response.status,
      errorCode: parsed.errorCode,
      errorMessage: parsed.errorMessage ?? `x_publish_failed_${response.status}`,
      rateLimit
    };
  }

  const postId =
    typeof payload === "object" &&
    payload !== null &&
    "data" in payload &&
    typeof (payload as { data?: { id?: string } }).data?.id === "string"
      ? (payload as { data: { id: string } }).data.id
      : undefined;

  return {
    ok: true,
    status: response.status,
    postId,
    rateLimit
  };
}

export async function refreshAccessTokenOnX(
  refreshToken: string,
  proxy?: AccountProxyConfig
): Promise<XRefreshResult> {
  const clientId = (process.env.AUTH_TWITTER_ID ?? "").trim();
  const clientSecret = (process.env.AUTH_TWITTER_SECRET ?? "").trim();
  if (!clientId || !clientSecret) {
    return {
      ok: false,
      status: 500,
      errorMessage: "OAuth client credentials are missing."
    };
  }

  if (process.env.MOCK_X_API === "1") {
    return {
      ok: true,
      accessToken: `mock_access_${Date.now()}`,
      refreshToken: refreshToken,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    };
  }

  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refreshToken);
  body.set("client_id", clientId);

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const requestInit: RequestInit & { dispatcher?: ProxyAgent } = {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString(),
    cache: "no-store"
  };
  const dispatcher = getProxyDispatcher(proxy);
  if (dispatcher) {
    requestInit.dispatcher = dispatcher;
  }
  const response = await fetch("https://api.x.com/2/oauth2/token", requestInit);

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      errorMessage: `refresh_failed_${response.status}`
    };
  }

  const source = payload as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!source?.access_token) {
    return {
      ok: false,
      status: 500,
      errorMessage: "refresh_missing_access_token"
    };
  }
  const expiresAt =
    typeof source.expires_in === "number" && Number.isFinite(source.expires_in)
      ? new Date(Date.now() + Math.max(1, Math.floor(source.expires_in)) * 1000)
      : null;
  return {
    ok: true,
    accessToken: source.access_token,
    refreshToken: source.refresh_token ?? null,
    expiresAt
  };
}

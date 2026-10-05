import Redis, { type RedisOptions } from "ioredis";

export function valkeyOptions(connectionUrl: string): RedisOptions {
  let url: URL;
  try {
    url = new URL(connectionUrl);
  } catch {
    throw new Error("VALKEY_URL must be a valid redis:// or rediss:// URL");
  }
  if (!["redis:", "rediss:"].includes(url.protocol) || !url.hostname) {
    throw new Error("VALKEY_URL must be a valid redis:// or rediss:// URL");
  }
  return {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    connectTimeout: 15000,
    commandTimeout: 15000,
    // Explicit retries below bound startup; do not reconnect a lost lease silently.
    retryStrategy: () => null,
    ...(url.protocol === "rediss:"
      ? {
          // Layerbase routes its shared TLS port by SNI, not by port number.
          tls: { servername: url.hostname, rejectUnauthorized: true },
        }
      : {}),
  };
}

function errorCode(error: unknown): string {
  const e = error as { code?: unknown; message?: unknown } | undefined;
  if (typeof e?.message === "string" && /^(WRONGPASS|NOAUTH)/.test(e.message))
    return "AUTHENTICATION_FAILED";
  return typeof e?.code === "string" && /^[A-Z0-9_]+$/.test(e.code)
    ? e.code
    : "CONNECTION_CLOSED";
}

export async function connectValkey(connectionUrl: string): Promise<Redis> {
  const options = valkeyOptions(connectionUrl);
  const target = new URL(connectionUrl);
  let code = "CONNECTION_CLOSED";
  for (let attempt = 0; attempt < 3; attempt++) {
    const redis = new Redis(connectionUrl, options);
    let socketError: unknown;
    // Capture the underlying error instead of ioredis's generic close rejection.
    // Do not log the URL or raw authentication errors containing credentials.
    redis.on("error", (error: Error) => {
      socketError = error;
    });
    try {
      await redis.connect();
      return redis;
    } catch (error) {
      code = errorCode(socketError ?? error);
      redis.disconnect();
      if (code === "AUTHENTICATION_FAILED") break;
      if (attempt < 2)
        await new Promise((resolve) =>
          setTimeout(resolve, 250 * (attempt + 1)),
        );
    }
  }
  throw new Error(
    `Valkey connection to ${target.hostname}:${target.port || "6379"} failed (${code}). Verify credentials, provider availability and TLS configuration; rediss:// sends the hostname as SNI.`,
  );
}

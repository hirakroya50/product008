interface ApiFailure {
  status?: number;
  code?: string;
  headers?: { get(name: string): string | null };
  error?: { code?: string };
  message?: string;
}
export function retryDelay(error: unknown, attempt: number, now = Date.now()) {
  const failure = error as ApiFailure;
  if (!failure || ![429, 500, 502, 503, 504].includes(failure.status ?? 0))
    return null;
  if (
    [
      "insufficient_quota",
      "billing_hard_limit_reached",
      "billing_not_active",
    ].includes(failure.code ?? failure.error?.code ?? "")
  )
    return null;
  if (
    /no credits remaining|insufficient quota|billing|credits? exhausted/i.test(
      failure.message ?? "",
    )
  )
    return null;
  const hint = failure.headers?.get("retry-after");
  let delay: number | undefined;
  if (hint) {
    const seconds = Number(hint);
    delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(hint) - now;
  } else {
    const milliseconds = Number(failure.headers?.get("retry-after-ms"));
    if (milliseconds > 0) delay = milliseconds;
    if (delay === undefined && failure.status === 429) {
      const reset = failure.headers?.get("x-ratelimit-reset-tokens") ?? "";
      if (/^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/.test(reset)) {
        delay = [...reset.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)].reduce(
          (total, match) =>
            total +
            Number(match[1]) *
              { ms: 1, s: 1000, m: 60000, h: 3600000 }[match[2]]!,
          0,
        );
      }
    }
  }
  if (delay !== undefined && Number.isFinite(delay) && delay > 59000)
    return null; // Never retry sooner than a long server hint.
  if (delay === undefined || !Number.isFinite(delay) || delay < 0)
    delay = Math.min(30000, 5000 * 2 ** attempt);
  return Math.ceil(delay + 100 + Math.random() * 400);
}

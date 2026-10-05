// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  failures: [] as Error[],
  clients: [] as { disconnected: boolean }[],
}));
vi.mock("ioredis", () => ({
  default: class {
    handlers = new Map<string, (e: Error) => void>();
    disconnected = false;
    constructor() {
      state.clients.push(this);
    }
    on(name: string, handler: (e: Error) => void) {
      this.handlers.set(name, handler);
      return this;
    }
    async connect() {
      const failure = state.failures.shift();
      if (failure) {
        this.handlers.get("error")?.(failure);
        throw new Error("Connection is closed.");
      }
    }
    disconnect() {
      this.disconnected = true;
    }
  },
}));
import { connectValkey, valkeyOptions } from "../harness/valkey";
beforeEach(() => {
  state.failures.length = 0;
  state.clients.length = 0;
});
describe("hosted Valkey startup", () => {
  it("sets verified TLS and explicit hostname SNI from the URL", () => {
    const options = valkeyOptions(
      "rediss://default:example-password@test.cloud.layerbase.dev",
    );
    expect(options.tls).toMatchObject({
      servername: "test.cloud.layerbase.dev",
      rejectUnauthorized: true,
    });
    expect(options.connectTimeout).toBe(15000);
    expect(options.retryStrategy?.(1)).toBeNull();
  });
  it("keeps local plaintext Redis supported", () => {
    expect(valkeyOptions("redis://127.0.0.1:6379").tls).toBeUndefined();
  });
  it.each(["not-a-url", "https://example.com"])(
    "rejects invalid connection %s without echoing it",
    (url) => {
      expect(() => valkeyOptions(url)).toThrow("VALKEY_URL must be a valid");
    },
  );
  it("returns the connected client", async () => {
    const client = await connectValkey("redis://localhost:6379");
    expect(state.clients).toHaveLength(1);
    expect(state.clients[0].disconnected).toBe(false);
    client.disconnect();
  });
  it("retries a sleeping service and disconnects the failed client", async () => {
    state.failures.push(
      Object.assign(new Error("socket reset"), { code: "ECONNRESET" }),
    );
    await connectValkey(
      "rediss://default:example-password@test.cloud.layerbase.dev",
    );
    expect(state.clients).toHaveLength(2);
    expect(state.clients[0].disconnected).toBe(true);
  });
  it("bounds retries and reports the socket cause without credentials", async () => {
    state.failures.push(
      ...Array.from({ length: 3 }, () =>
        Object.assign(new Error("private auth data"), { code: "ECONNRESET" }),
      ),
    );
    const error = await connectValkey(
      "rediss://default:example-password@test.cloud.layerbase.dev",
    ).then(
      () => {
        throw new Error("Expected connection failure");
      },
      (e) => e as Error,
    );
    expect(error.message).toContain("ECONNRESET");
    expect(error.message).not.toContain("example-password");
    expect(error.message).not.toContain("private auth data");
    expect(state.clients).toHaveLength(3);
    expect(state.clients.every((c) => c.disconnected)).toBe(true);
  });
  it("fails authentication immediately with a sanitized message", async () => {
    state.failures.push(new Error("WRONGPASS example-password"));
    await expect(
      connectValkey(
        "rediss://default:example-password@test.cloud.layerbase.dev",
      ),
    ).rejects.toThrow("AUTHENTICATION_FAILED");
    expect(state.clients).toHaveLength(1);
  });
});

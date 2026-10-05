import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Redis from "ioredis";
import { connectValkey } from "./valkey";
import { root } from "./common";
export class MemoryLease {
  private locks = new Map<string, { owner: string; expires: number }>();
  acquire(key: string, owner: string, ttl = 30000) {
    const l = this.locks.get(key);
    if (l && l.expires > Date.now()) return false;
    this.locks.set(key, { owner, expires: Date.now() + ttl });
    return true;
  }
  renew(key: string, owner: string, ttl = 30000) {
    const l = this.locks.get(key);
    if (!l || l.owner !== owner || l.expires <= Date.now()) return false;
    l.expires = Date.now() + ttl;
    return true;
  }
  release(key: string, owner: string) {
    const l = this.locks.get(key);
    if (!l || l.owner !== owner || l.expires <= Date.now()) return false;
    this.locks.delete(key);
    return true;
  }
}
export async function leaseProbe() {
  const l = new MemoryLease();
  if (
    !l.acquire("probe", "a") ||
    l.acquire("probe", "b") ||
    l.release("probe", "b") ||
    !l.renew("probe", "a") ||
    !l.release("probe", "a")
  )
    throw new Error("Lease probe failed");
  return {
    status: "passed",
    scope: "adapter-smoke-only",
    actions: ["acquire", "collision-denied", "renew", "owner-release"],
  };
}
// Cross-process offline lock uses atomic mkdir; no unsafe expiry takeover of a live writer.
export async function withLease<T>(fn: () => Promise<T>): Promise<T> {
  const owner = randomUUID();
  const ttl = 3600000;
  let redis: Redis | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let lost = false;
  const lock = path.join(root, "work", ".workspace-lock");
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  try {
    if (process.env.VALKEY_URL) {
      redis = await connectValkey(process.env.VALKEY_URL);
      if (
        (await redis.set("product008:workspace", owner, "PX", ttl, "NX")) !==
        "OK"
      )
        throw new Error("Concurrency collision denied");
      timer = setInterval(() => {
        void redis!
          .eval(
            "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('pexpire',KEYS[1],ARGV[2]) else return 0 end",
            1,
            "product008:workspace",
            owner,
            String(ttl),
          )
          .then((n) => {
            if (n !== 1) lost = true;
          })
          .catch(() => {
            lost = true;
          });
      }, 15000);
    } else {
      try {
        fs.mkdirSync(lock);
      } catch {
        throw new Error(
          "Concurrency collision denied; inspect work/.workspace-lock before manual recovery",
        );
      }
      fs.writeFileSync(
        path.join(lock, "owner.json"),
        JSON.stringify({
          owner,
          pid: process.pid,
          started: new Date().toISOString(),
        }),
      );
    }
    const result = await fn();
    if (lost) throw new Error("Lease ownership lost");
    return result;
  } finally {
    if (timer) clearInterval(timer);
    if (redis) {
      await redis
        .eval(
          "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
          1,
          "product008:workspace",
          owner,
        )
        .catch(() => {});
      redis.disconnect();
    } else if (
      fs.existsSync(path.join(lock, "owner.json")) &&
      JSON.parse(fs.readFileSync(path.join(lock, "owner.json"), "utf8"))
        .owner === owner
    )
      fs.rmSync(lock, { recursive: true });
  }
}

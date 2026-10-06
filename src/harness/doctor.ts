import fs from "node:fs";
import { connectValkey } from "./valkey";
import OpenAI from "openai";
import { run } from "./common";
import { leaseProbe } from "./lease";
export async function doctor(aiProbe = false) {
  const mode =
    process.env.HARNESS_MODE ??
    (process.env.OPENAI_API_KEY ? "openai" : "offline");
  if (!["offline", "openai"].includes(mode))
    throw new Error("Unknown HARNESS_MODE");
  if (
    mode === "openai" &&
    (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL)
  )
    throw new Error("OpenAI mode requires OPENAI_API_KEY and OPENAI_MODEL");
  const checks: Record<string, unknown> = {
    node: {
      status:
        Number(process.versions.node.split(".")[0]) >= 20 ? "passed" : "failed",
      version: process.version,
    },
    git: { status: "passed", version: run("git", ["--version"]) },
    runner: {
      status:
        process.platform === "darwin" && fs.existsSync("/usr/bin/sandbox-exec")
          ? "passed"
          : "failed",
      adapter: "macOS sandbox-exec",
      pnpm: run("pnpm", ["--version"]),
    },
  };
  if (process.env.VALKEY_URL) {
    const redis = await connectValkey(process.env.VALKEY_URL);
    try {
      checks.valkey = {
        status: (await redis.ping()) === "PONG" ? "passed" : "failed",
        adapter: "valkey",
      };
    } finally {
      redis.disconnect();
    }
  } else
    checks.valkey = {
      status: (await leaseProbe()).status,
      adapter: "memory smoke + atomic filesystem workspace lease",
      scope: "offline fallback",
    };
  if (aiProbe) {
    if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL)
      throw new Error("AI probe requires OPENAI_API_KEY and OPENAI_MODEL");
    const response = await new OpenAI({
      timeout: 30000,
      maxRetries: 0,
    }).responses.create({
      model: process.env.OPENAI_MODEL,
      max_output_tokens: 32,
      input: "Reply with OK.",
    });
    checks.inference = {
      status: response.output_text ? "passed" : "failed",
      adapter: "openai",
    };
  } else
    checks.inference = {
      status: "passed",
      adapter:
        mode === "openai"
          ? "openai; configuration checked only"
          : "deterministic offline shipping implementation",
      liveProbe: false,
    };
  if (
    Object.values(checks).some(
      (c) => (c as { status: string }).status !== "passed",
    )
  )
    throw new Error(JSON.stringify({ status: "failed", checks }));
  return { status: "passed", checks };
}

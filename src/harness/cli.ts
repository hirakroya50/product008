import { approve, run, write, getOption } from "./common";
import { withLease, leaseProbe } from "./lease";
import { intake, intakeIssue } from "./intake";
import { triager } from "./workers/triager";
import { fitter } from "./workers/fitter";
import { developer } from "./workers/developer";
import { tester } from "./workers/tester";
import { fixer } from "./workers/fixer";
import { gate, verifyPublication } from "./git";
import { doctor } from "./doctor";
import { collect, acceptance } from "./evidence";
const [command, ...args] = process.argv.slice(2);
const option = (name: string) => getOption(args, name);
const id = () => {
  const value = args.includes("--work") ? option("--work") : args[0];
  if (!value || value.startsWith("--"))
    throw new Error("Work id required (--work work-...)");
  return value;
};
async function main() {
  switch (command) {
    case "doctor":
      return doctor(args.includes("--ai-probe"));
    case "lease-probe":
      return leaseProbe();
    case "acceptance-status":
      return acceptance(args[0]);
    case "intake":
      approve(args);
      return withLease(async () => intake(args[0]));
    case "intake-issue":
      approve(args);
      return withLease(async () => intakeIssue(args[0]));
    case "triager":
      approve(args);
      return withLease(() => triager(id(), args.includes("--approve-cost")));
    case "fitter":
      approve(args, true);
      return withLease(async () =>
        fitter(id(), option("--paths")?.split(","), true),
      );
    case "developer":
      approve(args);
      return withLease(() => developer(id()));
    case "tester":
      approve(args);
      return withLease(async () => {
        const r = await tester(id());
        if (r.status !== "passed") process.exitCode = 1;
        return r;
      });
    case "fixer":
      approve(args);
      return withLease(() => fixer(id()));
    case "publication-check":
      return verifyPublication(id());
    case "git":
      approve(args);
      return withLease(async () => gate(id()));
    case "audit-start":
      approve(args);
      return withLease(async () => {
        let collisionDenied = false;
        try {
          await withLease(async () => false);
        } catch (e) {
          collisionDenied = String(e).includes("collision");
        }
        return write(id(), "audit.json", {
          initialClean: run("git", ["status", "--porcelain"]) === "",
          collisionDenied,
          startedAt: new Date().toISOString(),
        });
      });
    case "evidence":
      approve(args);
      return collect(
        id(),
        option("--output") ?? "docs/product-008/evidence.json",
      );
    case "help":
      return {
        commands: [
          "doctor [--ai-probe]",
          "lease-probe",
          "intake file --approve-write",
          "intake-issue number --approve-write",
          "triager work-id --approve-write [--approve-cost]",
          "developer|tester|fixer|git work-id --approve-write",
          "fitter --work work-id [--paths a,b,c] --approve-write --approve-cost",
          "acceptance-status file",
          "publication-check --work work-id",
          "evidence --work work-id --approve-write",
        ],
      };
    default:
      throw new Error("Unknown command. Use harness help.");
  }
}
main()
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => {
    console.error(JSON.stringify({ status: "failed", error: error.message }));
    process.exitCode = 1;
  });

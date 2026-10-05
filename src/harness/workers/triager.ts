import fs from "node:fs";
import { read, write, root, type Issue, type Diagnosis } from "../common";
export function triager(id: string) {
  const issue = read<Issue>(id, "intake.json");
  const supported = /free shipping.*(banner|progress)|shipping progress/i.test(
    issue.title + " " + issue.body,
  );
  const exists = fs.existsSync(root + "/src/components/CartDrawer.tsx");
  const diagnosis: Diagnosis = {
    issue,
    severity: "enhancement",
    subsystems: ["cart"],
    actionable: supported && exists,
    reproducible: exists,
    reason: supported
      ? "CartDrawer has no shipping progress indicator; implement $75 threshold with empty, partial and qualified states."
      : "Offline triage cannot establish a bounded supported change; human clarification required.",
  };
  return write(id, "diagnosis.json", diagnosis);
}

import fs from "node:fs";
import { read, write, root, type Issue, type Diagnosis } from "../common";
import { shippingRequest } from "../shipping-request";
export function triager(id: string) {
  const issue = read<Issue>(id, "intake.json");
  const request = shippingRequest(issue);
  const supported = request !== null;
  const exists = fs.existsSync(root + "/src/components/CartDrawer.tsx");
  const diagnosis: Diagnosis = {
    issue,
    severity: "enhancement",
    subsystems: ["cart"],
    actionable: supported && exists,
    reproducible: exists,
    reason: supported
      ? `Implement or update CartDrawer shipping progress with a $${request!.threshold} threshold and empty, partial and qualified states.`
      : "Offline triage cannot establish a bounded supported change; human clarification required.",
  };
  return write(id, "diagnosis.json", diagnosis);
}

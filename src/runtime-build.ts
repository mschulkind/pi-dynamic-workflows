import { randomUUID } from "node:crypto";

// Source execution is not a prebuilt artifact. Each evaluated source graph is
// conservatively distinct. The build replaces this module with a literal digest.
export const WORKFLOW_RUNTIME_BUILD_IDENTITY: string = `source:${randomUUID()}`;

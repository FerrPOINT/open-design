import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkNoHostedWorkflows } from "../../../scripts/guard.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("PDLC fork local verification", () => {
  it("accepts no workflows while retaining issue templates", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "od-local-gate-"));
    roots.push(root);
    await mkdir(path.join(root, ".github", "ISSUE_TEMPLATE"), { recursive: true });
    await writeFile(path.join(root, ".github", "ISSUE_TEMPLATE", "bug.yml"), "name: Bug\n");
    expect(await checkNoHostedWorkflows(root)).toBe(true);
  });

  it.each(["ci.yml", "release.yaml"])("rejects restored %s", async (file) => {
    const root = await mkdtemp(path.join(tmpdir(), "od-hosted-gate-"));
    roots.push(root);
    const directory = path.join(root, ".github", "workflows");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, file), "name: Unexpected hosted job\n");
    expect(await checkNoHostedWorkflows(root)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { uiP0Groups, validatePlaywrightSuiteTopology } from "../lib/playwright/suites.ts";

describe("local Playwright suite topology", () => {
  it("[P2] rejects duplicate file assignments across UI P0 shards", () => {
    const files = uiP0Groups["workspace-restoration"].files as unknown as string[];
    files.push("ui/app.test.ts");
    try {
      expect(validatePlaywrightSuiteTopology()).toContain("UI P0 CI matrix covers ui/app.test.ts more than once");
    } finally {
      files.pop();
    }
  });
});

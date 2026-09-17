import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("settings display current Grist table names instead of internal roles", () => {
  assert.match(appSource, /metadata\?\.tables\?\.\[tableRole\]\?\.tableId/);
  assert.match(appSource, /heading\.textContent = tableDisplayName\(group\.table\)/);
  assert.match(appSource, /displayMappingIssue\(row\)/);
});

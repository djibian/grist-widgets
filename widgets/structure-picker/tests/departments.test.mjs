import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DEPARTMENTS,
  departmentFromPostalCode,
  departmentInfo,
  formatDepartmentCodes,
  getActiveDepartments,
  normalizeDepartmentCode,
  normalizeDepartments,
  searchDepartments,
  setActiveDepartments,
} from "../departments.js";

test("44 et 85 restent la configuration initiale par défaut", () => {
  assert.deepEqual(DEFAULT_DEPARTMENTS, ["44", "85"]);
  assert.deepEqual(getActiveDepartments(), ["44", "85"]);
});

test("normalise, déduplique et ordonne les codes de département", () => {
  assert.equal(normalizeDepartmentCode("1"), "01");
  assert.equal(normalizeDepartmentCode("2b"), "2B");
  assert.equal(normalizeDepartmentCode("971"), "971");
  assert.equal(normalizeDepartmentCode("999"), "");
  assert.deepEqual(normalizeDepartments(["85", "44", "49", "44"], []), ["44", "49", "85"]);
});

test("recherche les départements par numéro ou par nom sans accents", () => {
  assert.equal(searchDepartments("44")[0]?.name, "Loire-Atlantique");
  assert.equal(searchDepartments("loire atlantique")[0]?.code, "44");
  assert.equal(searchDepartments("vendee")[0]?.code, "85");
  assert.equal(searchDepartments("maine et loire")[0]?.code, "49");
});

test("déduit correctement les départements depuis les codes postaux simples et ultramarins", () => {
  assert.equal(departmentFromPostalCode("44270"), "44");
  assert.equal(departmentFromPostalCode("97100"), "971");
  assert.equal(departmentFromPostalCode("97600"), "976");
  assert.equal(departmentFromPostalCode("20000"), "");
});

test("la configuration active est mutable mais toujours valide", () => {
  try {
    assert.equal(setActiveDepartments(["49", "44"]), true);
    assert.deepEqual(getActiveDepartments(), ["44", "49"]);
    assert.equal(formatDepartmentCodes(), "44 et 49");
    assert.equal(departmentInfo("49")?.name, "Maine-et-Loire");
    assert.equal(setActiveDepartments(["44", "49"]), false);
  } finally {
    setActiveDepartments(DEFAULT_DEPARTMENTS);
  }
});

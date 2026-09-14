import { createIndexedContactSource } from "./indexed.js";

function provenance(record = {}) {
  if (!record.hasAllThePlacesLineage) return [];
  return [{
    id: "all-the-places",
    label: "All The Places",
    recordType: "upstream",
    recordId: null,
  }];
}

export const overtureContactSource = createIndexedContactSource({
  id: "overture",
  label: "Overture Places",
  recordType: "place",
  provenance,
  score(record = {}) {
    const value = Number(record.confidence);
    return Number.isFinite(value) ? value : null;
  },
});

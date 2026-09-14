import { createIndexedContactSource } from "./indexed.js";

export const allThePlacesContactSource = createIndexedContactSource({
  id: "all-the-places",
  label: "All The Places",
  recordType(record = {}) {
    const spider = String(record.spider ?? "").trim();
    return spider || "poi";
  },
});

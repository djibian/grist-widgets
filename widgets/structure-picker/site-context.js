// Shared context comparisons live with the identity primitives to keep the
// matching contract independent of source transports (and avoid import cycles).
export {
  phoneKey,
  emailKey,
  webKey,
  contextualNameMatch,
  siteContextEvidence,
} from "./identity-resolution.js";

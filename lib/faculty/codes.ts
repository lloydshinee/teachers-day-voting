import "server-only";

/**
 * @deprecated Re-exported from @/lib/tokens/hashing for backwards compatibility.
 * Prefer importing directly from @/lib/tokens.
 */

import {
  canonicalCodeLetters,
  hashCode,
  hashNormalizedLetters,
} from "../tokens/hashing";

export {
  canonicalCodeLetters,
  hashCode,
  hashCode as hashFacultyCode,
  hashNormalizedLetters,
  hashNormalizedLetters as hashNormalizedCodeLetters,
};

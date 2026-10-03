/**
 * @deprecated Re-exported from @/lib/tokens/format for backwards compatibility.
 * Prefer importing directly from @/lib/tokens.
 */

import {
  CODE_ALPHABET,
  CODE_LETTER_COUNT,
  CODE_GROUP_SIZE,
  CODE_GROUP_COUNT,
  formatCode,
  normalizeCode,
  codeSchema,
  generateCode,
  type VotingCode,
} from "../tokens/format";

export {
  CODE_ALPHABET,
  CODE_LETTER_COUNT,
  CODE_GROUP_SIZE,
  CODE_GROUP_COUNT,
  formatCode,
  formatCode as formatFacultyCode,
  normalizeCode,
  normalizeCode as normalizeFacultyCode,
  codeSchema,
  codeSchema as facultyCodeSchema,
  generateCode,
  generateCode as generateFacultyCode,
  type VotingCode,
  type VotingCode as FacultyCode,
};

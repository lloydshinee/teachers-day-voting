/**
 * Self-test for the faculty Code format (spec §6, task 8).
 *
 * Run: `node_modules/.bin/jiti lib/faculty/code-format.self-test.ts`
 * Covers: alphabet shape (31 unambiguous symbols), grouping, normalization
 * round-trips, rejection of confusables, and a uniqueness spot-check over
 * generated Codes.
 */

import assert from "node:assert/strict";

import {
  CODE_ALPHABET,
  CODE_GROUP_COUNT,
  CODE_GROUP_SIZE,
  CODE_LETTER_COUNT,
  facultyCodeSchema,
  formatFacultyCode,
  generateFacultyCode,
  normalizeFacultyCode,
} from "./code-format.js";

let passed = 0;

function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

check("alphabet holds 32 unambiguous symbols (60-bit Codes)", () => {
  assert.equal(CODE_ALPHABET.length, 32);
  assert.equal(new Set(CODE_ALPHABET).size, 32);
  for (const confusable of ["0", "O", "1", "I"]) {
    assert.equal(
      CODE_ALPHABET.includes(confusable),
      false,
      `alphabet must exclude ${confusable}`,
    );
  }
  // The approved example from spec §6 validates under this alphabet.
  assert.equal(facultyCodeSchema.safeParse("7K9P-X2MA-Q4LT").success, true);
  // 12 × log2(32) = 60 bits — the approved ~60-bit envelope.
  const bits = CODE_LETTER_COUNT * Math.log2(CODE_ALPHABET.length);
  assert.equal(bits, 60);
});

check("generated Codes validate and carry 3 groups of 4", () => {
  for (let i = 0; i < 25; i += 1) {
    const code = generateFacultyCode();
    assert.equal(facultyCodeSchema.safeParse(code).success, true, code);
    const groups = code.split("-");
    assert.equal(groups.length, CODE_GROUP_COUNT);
    for (const group of groups) {
      assert.equal(group.length, CODE_GROUP_SIZE);
    }
    assert.equal(code.replace(/-/g, "").length, CODE_LETTER_COUNT);
  }
});

check("normalization accepts lowercase, missing dashes, and padding spaces", () => {
  assert.equal(normalizeFacultyCode("7k9p-x2ma-q4lt"), "7K9P-X2MA-Q4LT");
  assert.equal(normalizeFacultyCode("7K9PX2MAQ4LT"), "7K9P-X2MA-Q4LT");
  assert.equal(normalizeFacultyCode("  7K9P-X2MA-Q4LT  "), "7K9P-X2MA-Q4LT");
  assert.equal(
    normalizeFacultyCode(formatFacultyCode("ABCDEFGHJKLM")),
    "ABCD-EFGH-JKLM",
  );
});

check("normalization rejects confusables, wrong lengths, and junk", () => {
  assert.equal(normalizeFacultyCode("7K9P-X2MA-Q4L0"), null); // digit 0
  assert.equal(normalizeFacultyCode("7K9P-X2MA-Q4LO"), null); // letter O
  assert.equal(normalizeFacultyCode("7K9P-X2MA-Q4L1"), null); // digit 1
  assert.equal(normalizeFacultyCode("7K9P-X2MA-Q4LI"), null); // letter I
  assert.equal(normalizeFacultyCode("7K9P-X2MA-Q4L"), null); // short
  assert.equal(normalizeFacultyCode("7K9P-X2MA-Q4LTX"), null); // long
  assert.equal(normalizeFacultyCode(""), null);
});

check("generated Codes are unique across a batch spot-check", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i += 1) {
    const code = generateFacultyCode();
    assert.equal(seen.has(code), false, `duplicate Code ${code}`);
    seen.add(code);
  }
});

console.log(`\nAll ${passed} Code-format self-test groups passed.`);

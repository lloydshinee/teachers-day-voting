import assert from "node:assert/strict";

import {
  CODE_ALPHABET,
  normalizeCode,
  normalizeCodeLetters,
  codeSchema,
  generateCode,
} from "./format";
import { hashCode } from "./hashing";
import { buildVoteCodeLink, VOTE_PATH } from "./vote-link";

function runTests() {
  // Test 1: Alphabet and length invariants
  assert.equal(CODE_ALPHABET.length, 32, "Alphabet must have exactly 32 symbols (60-bit entropy)");
  assert.equal(CODE_ALPHABET.includes("0"), false, "Alphabet must exclude confusable '0'");
  assert.equal(CODE_ALPHABET.includes("O"), false, "Alphabet must exclude confusable 'O'");
  assert.equal(CODE_ALPHABET.includes("1"), false, "Alphabet must exclude confusable '1'");
  assert.equal(CODE_ALPHABET.includes("I"), false, "Alphabet must exclude confusable 'I'");
  console.log("PASS alphabet holds 32 unambiguous symbols (no 0/O, 1/I)");

  // Test 2: Formatting and generation
  const generated = generateCode();
  assert.match(
    generated,
    /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/,
    "Generated code must match XXXX-XXXX-XXXX shape",
  );
  assert.equal(codeSchema.safeParse(generated).success, true);
  console.log("PASS generated codes validate against canonical schema");

  // Test 3: Normalization
  const rawWithSpaces = " 7k9p x2ma q4lt ";
  const normalized = normalizeCode(rawWithSpaces);
  assert.equal(normalized, "7K9P-X2MA-Q4LT");
  assert.equal(normalizeCode("7K9P-X2MA-Q4L0"), null, "Must reject confusable '0'");
  assert.equal(normalizeCode("7K9P"), null, "Must reject short code");
  assert.equal(normalizeCodeLetters(rawWithSpaces), "7K9PX2MAQ4LT");
  assert.equal(normalizeCodeLetters("7K9P-X2MA-Q4L0"), null);
  console.log("PASS normalization cleans dashes/case and rejects invalid symbols");

  // Test 4: Hashing with custom pepper
  const testPepper = "test-pepper-123";
  const hash1 = hashCode("7K9P-X2MA-Q4LT", testPepper);
  const hash2 = hashCode("7k9p x2ma q4lt", testPepper);
  assert.ok(hash1, "Hash must not be null");
  assert.equal(hash1, hash2, "Normalized variations must produce identical hash");
  assert.equal(hash1?.length, 64, "SHA-256 hex must be 64 characters");
  console.log("PASS pepper hashing produces uniform 64-char hex digest");

  // Test 5: QR payload link construction
  assert.equal(buildVoteCodeLink("7K9P-X2MA-Q4LT"), "/vote?token=7K9P-X2MA-Q4LT");
  assert.equal(
    buildVoteCodeLink("7K9P-X2MA-Q4LT", "https://voting.school.edu"),
    "https://voting.school.edu/vote?token=7K9P-X2MA-Q4LT",
  );
  assert.equal(
    buildVoteCodeLink("7K9P-X2MA-Q4LT", "https://voting.school.edu/"),
    "https://voting.school.edu/vote?token=7K9P-X2MA-Q4LT",
  );
  assert.equal(VOTE_PATH, "/vote");
  console.log("PASS QR link payload constructs /vote?token=<CODE> cleanly (relative and absolute)");

  console.log("\nTokens module suite: all 5 test groups passed.");
}

runTests();

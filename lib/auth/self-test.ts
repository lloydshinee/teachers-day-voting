import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  requireAdminSession,
  DEFAULT_FORBIDDEN_MESSAGE,
  DEFAULT_UNAUTHENTICATED_MESSAGE,
  type AdminSessionAdapter,
  type AdminSessionResult,
} from "./admin-session";

class MockAdminAdapter implements AdminSessionAdapter {
  constructor(private result: AdminSessionResult) {}

  async resolve(): Promise<AdminSessionResult> {
    return this.result;
  }
}

async function runTests() {
  // Test 1: Successful admin session resolution
  const fakeClient = {} as SupabaseClient;
  const successAdapter = new MockAdminAdapter({
    ok: true,
    session: {
      adminId: "admin-123",
      supabase: fakeClient,
    },
  });

  const res1 = await requireAdminSession({ adapter: successAdapter });
  assert.equal(res1.ok, true);
  if (res1.ok) {
    assert.equal(res1.session.adminId, "admin-123");
    assert.equal(res1.session.supabase, fakeClient);
  }
  console.log("PASS successful admin session resolution");

  // Test 2: Unauthenticated session rejection
  const unauthAdapter = new MockAdminAdapter({
    ok: false,
    code: "UNAUTHENTICATED",
    message: DEFAULT_UNAUTHENTICATED_MESSAGE,
  });

  const res2 = await requireAdminSession({ adapter: unauthAdapter });
  assert.equal(res2.ok, false);
  if (!res2.ok) {
    assert.equal(res2.code, "UNAUTHENTICATED");
    assert.equal(res2.message, DEFAULT_UNAUTHENTICATED_MESSAGE);
  }
  console.log("PASS unauthenticated session rejection with default message");

  // Test 3: Forbidden session rejection
  const forbiddenAdapter = new MockAdminAdapter({
    ok: false,
    code: "FORBIDDEN",
    message: DEFAULT_FORBIDDEN_MESSAGE,
  });

  const res3 = await requireAdminSession({ adapter: forbiddenAdapter });
  assert.equal(res3.ok, false);
  if (!res3.ok) {
    assert.equal(res3.code, "FORBIDDEN");
    assert.equal(res3.message, DEFAULT_FORBIDDEN_MESSAGE);
  }
  console.log("PASS forbidden non-admin rejection with default message");

  // Test 4: Custom messages supported
  const customAdapter = new MockAdminAdapter({
    ok: false,
    code: "UNAUTHENTICATED",
    message: "Custom sign in required.",
  });

  const res4 = await requireAdminSession({ adapter: customAdapter });
  assert.equal(res4.ok, false);
  if (!res4.ok) {
    assert.equal(res4.message, "Custom sign in required.");
  }
  console.log("PASS custom error messages supported");

  console.log("\nAdmin session suite: all 4 tests passed.");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

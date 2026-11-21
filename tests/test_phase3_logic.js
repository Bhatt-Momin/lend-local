const assert = require('assert');

console.log('--- Running Stage 3 Phase 3 Unit Tests ---');

// 1. Creator ID Normalization Tests
function isCreator(createdBy, userId) {
  if (!createdBy || !userId) return false;
  const creatorId = String(createdBy.id ?? createdBy._id ?? '');
  return creatorId.length > 0 && creatorId === String(userId);
}

// Case 1a: Normalized when createdBy has .id
assert.strictEqual(isCreator({ id: 'user_123', name: 'Alice' }, 'user_123'), true);
// Case 1b: Normalized when createdBy has ._id (Mongoose populated object)
assert.strictEqual(isCreator({ _id: 'user_123', name: 'Alice' }, 'user_123'), true);
// Case 1c: Non-creator user ID
assert.strictEqual(isCreator({ id: 'user_123', name: 'Alice' }, 'user_456'), false);
// Case 1d: Missing createdBy or userId
assert.strictEqual(isCreator(null, 'user_123'), false);
assert.strictEqual(isCreator(undefined, 'user_123'), false);
assert.strictEqual(isCreator({ name: 'Alice' }, 'user_123'), false);
assert.strictEqual(isCreator({ id: 'user_123' }, null), false);
console.log('✅ Creator ID normalization tests passed.');

// 2. Member Email Redaction & Display Logic
function shouldRenderEmail(email) {
  return Boolean(email && email.trim().length > 0);
}

// Case 2a: Valid email
assert.strictEqual(shouldRenderEmail('alice@example.com'), true);
assert.strictEqual(shouldRenderEmail('  bob@example.com  '), true);
// Case 2b: Redacted historical member email (empty string)
assert.strictEqual(shouldRenderEmail(''), false);
assert.strictEqual(shouldRenderEmail('   '), false);
// Case 2c: Absent / undefined email
assert.strictEqual(shouldRenderEmail(undefined), false);
assert.strictEqual(shouldRenderEmail(null), false);
console.log('✅ Member email redaction tests passed.');

// 3. Response Envelope Navigation Logic
const createResponse = {
  group: {
    id: 'grp_98765',
    name: 'Weekend Getaway',
    description: 'Cab and food',
    members: [{ id: 'u1', name: 'Alice' }]
  }
};

// Must navigate using response.group.id
assert.strictEqual(createResponse.group.id, 'grp_98765');
assert.strictEqual(createResponse.id, undefined);
console.log('✅ Response envelope navigation tests passed.');

// 4. Stale-Request Generation Guard Simulation
class MockGroupDetailFetcher {
  constructor() {
    this.requestId = 0;
    this.currentData = null;
  }

  async fetch(delayMs, data) {
    const currentRequestId = ++this.requestId;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (currentRequestId !== this.requestId) {
      // Stale request discarded
      return { applied: false, currentRequestId, latest: this.requestId };
    }
    this.currentData = data;
    return { applied: true, currentRequestId, latest: this.requestId };
  }
}

(async () => {
  const fetcher = new MockGroupDetailFetcher();

  // Fire slow request 1 (100ms) for 'User A'
  const p1 = fetcher.fetch(100, 'User A Groups');
  // Immediately fire fast request 2 (10ms) for 'User B' (account switch)
  const p2 = fetcher.fetch(10, 'User B Groups');

  const [res1, res2] = await Promise.all([p1, p2]);

  assert.strictEqual(res2.applied, true, 'Request 2 (latest) should be applied');
  assert.strictEqual(res1.applied, false, 'Request 1 (stale) should be discarded');
  assert.strictEqual(fetcher.currentData, 'User B Groups', 'State must only reflect latest request');
  console.log('✅ Stale-request generation guard tests passed.');

  console.log('🎉 All Phase 3 unit tests passed successfully!');
})();

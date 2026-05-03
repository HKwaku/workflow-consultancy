/**
 * Tests for lib/cronAuth.js
 *
 * Run: node --test tests/cronAuth.test.mjs
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { isAuthorisedCron } from '../lib/cronAuth.js';

function makeReq(headers = {}) {
  return { headers: { get: (k) => headers[k.toLowerCase()] || null } };
}

describe('isAuthorisedCron', () => {
  beforeEach(() => { delete process.env.CRON_SECRET; });

  test('returns true when CRON_SECRET is unset (dev)', () => {
    assert.equal(isAuthorisedCron(makeReq()), true);
    assert.equal(isAuthorisedCron(makeReq({ authorization: 'Bearer anything' })), true);
  });

  test('returns true when secret matches', () => {
    process.env.CRON_SECRET = 'topsecret';
    assert.equal(isAuthorisedCron(makeReq({ authorization: 'Bearer topsecret' })), true);
  });

  test('returns false when secret missing or wrong', () => {
    process.env.CRON_SECRET = 'topsecret';
    assert.equal(isAuthorisedCron(makeReq()), false);
    assert.equal(isAuthorisedCron(makeReq({ authorization: 'Bearer wrong' })), false);
    assert.equal(isAuthorisedCron(makeReq({ authorization: 'Basic topsecret' })), false);
  });

  test('case-sensitive comparison on the token (defence against bypass typos)', () => {
    process.env.CRON_SECRET = 'TopSecret';
    assert.equal(isAuthorisedCron(makeReq({ authorization: 'Bearer topsecret' })), false);
    assert.equal(isAuthorisedCron(makeReq({ authorization: 'Bearer TopSecret' })), true);
  });
});

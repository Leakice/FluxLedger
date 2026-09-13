import test from 'node:test';
import assert from 'node:assert/strict';
import { uidHash, maskedUserId } from './uidHash.js';

test('uidHash is deterministic, hex, and 8 chars wide', () => {
  const first = uidHash('user_abc123');
  const second = uidHash('user_abc123');
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{8}$/);
});

test('uidHash separates distinct ids and matches the reference vector', () => {
  assert.notEqual(uidHash('user_abc123'), uidHash('user_abc124'));
  // FNV-1a 32 位参考值（避免实现漂移：命名空间键依赖跨会话稳定）。
  assert.equal(uidHash(''), '811c9dc5');
  assert.equal(uidHash('a'), 'e40c292c');
  assert.equal(uidHash('local_seedy'), uidHash('local_seedy'));
});

test('maskedUserId keeps head and tail only', () => {
  assert.equal(maskedUserId('us1234567890abcd'), 'us…abcd');
  assert.equal(maskedUserId('abcde'), 'ab…');
  assert.equal(maskedUserId(''), '…');
});

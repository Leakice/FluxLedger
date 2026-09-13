import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEDGER_DOCUMENT_KEYS, LEDGER_DOCUMENT_MAX_BYTES,
  buildLedgerDocument, documentByteSize, validateBaseVersion, validateLedgerDocument,
} from './ledger-document.js';

const validDocument = () => ({ transactions: [], cards: [], hiddenBuiltInCardIds: ['online-alipay'] });

test('a document is exactly the three array keys', () => {
  assert.equal(validateLedgerDocument(validDocument()), true);
  assert.deepEqual(LEDGER_DOCUMENT_KEYS, ['transactions', 'cards', 'hiddenBuiltInCardIds']);
});

test('validation rejects non-objects, arrays and null', () => {
  assert.equal(validateLedgerDocument(null), false);
  assert.equal(validateLedgerDocument([]), false);
  assert.equal(validateLedgerDocument('ledger'), false);
  assert.equal(validateLedgerDocument(42), false);
  assert.equal(validateLedgerDocument(undefined), false);
});

test('validation rejects missing, non-array or unknown keys', () => {
  assert.equal(validateLedgerDocument({ transactions: [], cards: [] }), false, 'missing key');
  assert.equal(validateLedgerDocument({ transactions: [], cards: [], hiddenBuiltInCardIds: 'no' }), false, 'non-array value');
  assert.equal(
    validateLedgerDocument({ ...validDocument(), extra: [] }),
    false,
    'unknown keys are rejected so the document schema cannot drift silently',
  );
});

test('validation rejects array entries that would crash the frontend calculations', () => {
  assert.equal(validateLedgerDocument({ transactions: [null], cards: [], hiddenBuiltInCardIds: [] }), false, 'null entry');
  assert.equal(validateLedgerDocument({ transactions: ['x'], cards: [], hiddenBuiltInCardIds: [] }), false, 'scalar entry');
  assert.equal(validateLedgerDocument({ transactions: [[]], cards: [], hiddenBuiltInCardIds: [] }), false, 'nested array entry');
  assert.equal(validateLedgerDocument({ transactions: [], cards: [], hiddenBuiltInCardIds: [null] }), false, 'id lists take non-empty strings only');
  assert.equal(
    validateLedgerDocument({ transactions: [{ id: 't1' }], cards: [{ id: 'c1' }], hiddenBuiltInCardIds: ['online-wechat'] }),
    true,
    'object lists take plain objects; id lists take non-empty strings',
  );
});

test('buildLedgerDocument produces exactly the stored shape', () => {
  const transactions = [{ id: 't1' }];
  const cards = [{ id: 'c1' }];
  const hidden = ['online-wechat'];
  assert.deepEqual(buildLedgerDocument(transactions, cards, hidden), {
    transactions, cards, hiddenBuiltInCardIds: hidden,
  });
});

test('baseVersion must be a non-negative safe integer', () => {
  assert.equal(validateBaseVersion(0), true);
  assert.equal(validateBaseVersion(3), true);
  assert.equal(validateBaseVersion(-1), false);
  assert.equal(validateBaseVersion(1.5), false);
  assert.equal(validateBaseVersion('3'), false);
  assert.equal(validateBaseVersion(null), false);
  assert.equal(validateBaseVersion(true), false);
});

test('document byte size is measured and capped far below storage limits', () => {
  const small = buildLedgerDocument([{ id: 't1', description: '咖啡' }], [], []);
  const size = documentByteSize(small);
  assert.ok(Number.isFinite(size) && size > 0);
  assert.ok(size > JSON.stringify(small).length / 4, 'multi-byte characters are not under-counted');
  assert.ok(size < LEDGER_DOCUMENT_MAX_BYTES);
  const oversized = buildLedgerDocument([{ id: 't2', description: 'x'.repeat(LEDGER_DOCUMENT_MAX_BYTES) }], [], []);
  assert.ok(documentByteSize(oversized) > LEDGER_DOCUMENT_MAX_BYTES, 'the API rejects these with 413');
});

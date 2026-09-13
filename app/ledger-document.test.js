import test from 'node:test';
import assert from 'node:assert/strict';
import { LEDGER_DOCUMENT_KEYS, buildLedgerDocument, validateBaseVersion, validateLedgerDocument } from './ledger-document.js';

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
  assert.equal(
    validateLedgerDocument({ transactions: [1], cards: [{ id: 'x' }], hiddenBuiltInCardIds: [] }),
    true,
    'element shapes are the ledger/domain layer’s concern, arrays are the document’s contract',
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

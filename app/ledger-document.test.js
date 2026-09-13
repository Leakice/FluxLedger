import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEDGER_DOCUMENT_KEYS, LEDGER_DOCUMENT_MAX_BYTES,
  buildLedgerDocument, documentByteSize, validateBaseVersion, validateLedgerDocument,
} from './ledger-document.js';

const validDocument = () => ({ transactions: [], cards: [], hiddenBuiltInCardIds: ['online-alipay'] });
const fullTransaction = overrides => ({
  id: 't1', type: 'expense', amount: 5, date: '2026-09-01',
  card: '4329', category: 'Food & Drinks', description: 'Coffee', ...overrides,
});
const fullCard = overrides => ({
  id: 'c1', name: 'Everyday card', color: '#f4cf35', network: 'Visa', accountType: 'Savings card', ...overrides,
});

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
  assert.equal(validateLedgerDocument({ transactions: [], cards: [null], hiddenBuiltInCardIds: [] }), false, 'null card');
});

test('transactions missing any unconditionally-read field are rejected', () => {
  // 复现用例：缺 date 的记录此前通过校验，前端 e.date.startsWith 直接抛 TypeError。
  assert.equal(validateLedgerDocument({ transactions: [{ id: 'bad', type: 'expense' }], cards: [], hiddenBuiltInCardIds: [] }), false);
  assert.equal(validateLedgerDocument({ transactions: [fullTransaction({ date: '2026/09/01' })], cards: [], hiddenBuiltInCardIds: [] }), false, 'date shape');
  assert.equal(validateLedgerDocument({ transactions: [fullTransaction({ type: 'transfer' })], cards: [], hiddenBuiltInCardIds: [] }), false, 'unknown type');
  assert.equal(validateLedgerDocument({ transactions: [fullTransaction({ amount: '5' })], cards: [], hiddenBuiltInCardIds: [] }), false, 'amount type');
  assert.equal(validateLedgerDocument({ transactions: [fullTransaction({ card: '' })], cards: [], hiddenBuiltInCardIds: [] }), false, 'empty card');
  assert.equal(validateLedgerDocument({ transactions: [fullTransaction({ description: undefined })], cards: [], hiddenBuiltInCardIds: [] }), false, 'description must be a string');
  assert.equal(
    validateLedgerDocument({ transactions: [fullTransaction({ id: 42 }), fullTransaction()], cards: [fullCard()], hiddenBuiltInCardIds: [] }),
    true,
    'numeric ids (legacy seed) and complete records pass',
  );
  assert.equal(
    validateLedgerDocument({ transactions: [fullTransaction({ onCredit: true, purchaseId: 'p1' })], cards: [fullCard({ last4: '1001', noLast4: true })], hiddenBuiltInCardIds: [] }),
    true,
    'extra domain fields stay allowed; optional card fields stay optional',
  );
});

test('cards missing render-critical fields are rejected', () => {
  assert.equal(validateLedgerDocument({ transactions: [], cards: [{ id: 'c1' }], hiddenBuiltInCardIds: [] }), false);
  assert.equal(validateLedgerDocument({ transactions: [], cards: [fullCard({ name: '' })], hiddenBuiltInCardIds: [] }), false, 'empty name');
  assert.equal(validateLedgerDocument({ transactions: [], cards: [fullCard({ color: '#fff', network: 1 })], hiddenBuiltInCardIds: [] }), false, 'network type');
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

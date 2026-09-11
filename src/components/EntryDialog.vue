<script setup>
import { computed, reactive, ref } from 'vue';
import { creditAccountCards, entryKinds, resolveCreditAccountCard, accountLast4, isOnlineLoanAccount, accountTypeOf, canRecordIncome, creditPurchases, isCreditSpendingAccount } from '../ledger';
const props = defineProps({ cards: Array, entries: Array, error: String, t: Function });
const emit = defineEmits(['save']);
const dialog = ref(null);
const form = reactive({});
const purchases = computed(() => creditPurchases((props.entries||[]).filter(e => e.id !== form.id)).filter(e => e.due > 0 && e.date <= form.date));
function linkPurchase(){form.toCard=purchases.value.find(e=>e.id===form.purchaseId)?.card||''}
const originalEntry = ref(null);
const categories = ['Food & Drinks','Entertainment','Utilities','Shopping','Subscription','Other','Salary','Transfer'];
const loanAccount = '借款';
const creditAccounts = computed(() => [
  ...creditAccountCards.filter(card => resolveCreditAccountCard(props.cards, card.name)).map(card => card.name),
  loanAccount
]);
const availableCards = computed(() => props.cards.filter(card => form.type !== 'income' || canRecordIncome(card, originalEntry.value)));
const isLoan = () => form.type === 'credit' && form.description === loanAccount;
function open(type, date, entry = null) {
  originalEntry.value = entry?.id != null ? { ...entry } : null;
  const defaultCreditCard = creditAccountCards.map(card => resolveCreditAccountCard(props.cards, card.name)).find(Boolean) || props.cards.find(card => isOnlineLoanAccount(card) || accountTypeOf(card) === 'Credit card');
  const borrower = entry?.description === loanAccount ? entry.borrower || props.cards.find(card => card.id === entry.card)?.name || '' : '';
  Object.assign(form, { onCredit: false, purchaseId: '', toCard: '', id: null, description: type === 'credit' ? defaultCreditCard?.name || loanAccount : '', amount: '', type, category: type === 'credit' ? 'Credit limit' : type === 'income' ? 'Salary' : 'Food & Drinks', date, card: type === 'credit' ? defaultCreditCard?.id || '' : props.cards.find(card => type !== 'income' || !isOnlineLoanAccount(card))?.id || '', borrower }, entry || {});
  if (type === 'credit' && form.description === loanAccount) form.borrower = borrower;
  dialog.value.showModal();
}
function selectCreditAccount(account) {
  form.card = resolveCreditAccountCard(props.cards, account)?.id || '';
  if (account !== loanAccount) form.borrower = '';
}
function selectCard() {
  if (form.type === 'credit') form.description = props.cards.find(card => card.id === form.card)?.name || '';
}
function save() {
  const amount = Number(form.amount);
  const loan = isLoan();
  if (!Number.isFinite(amount) || (form.type === 'credit' ? amount < 0 : amount <= 0) || !form.description.trim() || (loan ? !form.borrower.trim() : !availableCards.value.some(card => card.id === form.card))) return;
  if(form.type==='repayment')linkPurchase();
  form.id ??= crypto.randomUUID();
  const entry = { ...form, onCredit: form.type === 'expense' && isCreditSpendingAccount(props.cards.find(c => c.id === form.card)), amount, description: form.description.trim(), category: form.type === 'credit' ? 'Credit limit' : form.type==='repayment'?'Repayments':form.category };
  if (loan) entry.borrower = form.borrower.trim(); else delete entry.borrower;
  if(entry.type!=='repayment'){delete entry.purchaseId;delete entry.toCard;}
  emit('save', entry);

}
defineExpose({ open, close: () => dialog.value.close() });
</script>

<template>
  <dialog ref="dialog" class="edit-dialog">
    <form @submit.prevent="save">
      <div class="card-heading"><div><span class="eyebrow">{{ t(entryKinds.find(k=>k.type===form.type)?.label || 'Expenses') }}</span><h2>{{ t(form.id?'Edit transaction':entryKinds.find(k=>k.type===form.type)?.action || 'Add expense') }}</h2></div><button type="button" class="icon" :aria-label="t('Close')" @click="dialog.close()">×</button></div>
      <p class="form-note">{{ t(form.type==='credit'?'The latest limit replaces the previous limit. It is not income.':'A small entry. A clearer picture.') }}</p>
      <label v-if="form.type==='credit'">{{ t('Description') }}<select v-model="form.description" required @change="selectCreditAccount(form.description)"><option v-for="account in creditAccounts" :key="account" :value="account">{{ account }}</option><option v-if="form.description && !creditAccounts.includes(form.description)" :value="form.description">{{ form.description }}</option></select></label>
      <label v-else>{{ t('Description') }}<input v-model="form.description" required maxlength="80" :placeholder="t('e.g. Groceries')"></label>
      <div class="form-row"><label>{{ t(form.type==='credit'?'Credit limit (¥)':'Amount (¥)') }}<input v-model="form.amount" type="number" :min="form.type==='credit'?0:0.01" max="999999999" step="0.01" required placeholder="0.00"></label><label>{{ t(form.type==='credit'?'Effective date':'Date') }}<input v-model="form.date" type="date" required></label></div>
      <label v-if="form.type!=='credit'&&form.type!=='repayment'">{{ t('Category') }}<select v-model="form.category"><option v-for="item in categories" :key="item" :value="item">{{ t(item) }}</option></select></label>
      <label v-if="isLoan()">{{ t('Borrower') }}<input v-model="form.borrower" required maxlength="80" :placeholder="t('e.g. Lender')"></label>
      <label v-else>{{ t(form.type==='repayment'?'Paying account':'Account') }}<select v-model="form.card" required @change="selectCard"><option v-for="card in availableCards" :key="card.id" :value="card.id">{{ t(card.name) }}<template v-if="accountLast4(card)"> · {{ t(card.network) }} •••• {{ accountLast4(card) }}</template></option></select></label>
      <template v-if="form.type==='repayment'">
        <label>{{ t('Linked credit purchase') }}<select v-model="form.purchaseId" required @change="linkPurchase"><option disabled value="">{{ t('Select credit purchase') }}</option><option v-for="p in purchases" :key="p.id" :value="p.id">{{ p.description }} · {{ t(cards.find(c=>c.id===p.card)?.name) }} · {{ t('Amount due') }} ¥{{ p.due.toFixed(2) }}</option></select></label>
        <p class="form-note">{{ t('Repayment moves cash to a credit account. It is not another expense.') }}</p>
      </template>
      <p v-if="error" role="alert" class="form-error">{{ t(error) }}</p>
      <button class="primary submit" type="submit">{{ t(form.id?'Save changes':'Save transaction ↗') }}</button>
    </form>
  </dialog>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { creditAccountCards, entryKinds, resolveCreditAccountCard, accountLast4, isOnlineLoanAccount, accountTypeOf } from '../ledger';
const props = defineProps({ cards: Array, t: Function });
const emit = defineEmits(['save']);
const dialog = ref(null);
const form = reactive({});
const categories = ['Food & Drinks','Entertainment','Utilities','Shopping','Subscription','Other','Salary','Transfer'];
const loanAccount = '借款';
const creditAccounts = computed(() => [
  ...creditAccountCards.filter(card => resolveCreditAccountCard(props.cards, card.name)).map(card => card.name),
  loanAccount
]);
const availableCards = computed(() => props.cards.filter(card => form.type !== 'income' || !isOnlineLoanAccount(card)));
const isLoan = () => form.type === 'credit' && form.description === loanAccount;
function open(type, date, entry = null) {
  const defaultCreditCard = creditAccountCards.map(card => resolveCreditAccountCard(props.cards, card.name)).find(Boolean) || props.cards.find(card => isOnlineLoanAccount(card) || accountTypeOf(card) === 'Credit card');
  const borrower = entry?.description === loanAccount ? entry.borrower || props.cards.find(card => card.id === entry.card)?.name || '' : '';
  Object.assign(form, { id: null, description: type === 'credit' ? defaultCreditCard?.name || loanAccount : '', amount: '', type, category: type === 'credit' ? 'Credit limit' : type === 'income' ? 'Salary' : 'Food & Drinks', date, card: type === 'credit' ? defaultCreditCard?.id || '' : props.cards.find(card => type !== 'income' || !isOnlineLoanAccount(card))?.id || '', borrower }, entry || {});
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
  const creditCard = form.type === 'credit' ? resolveCreditAccountCard(props.cards, form.description) : undefined;
  const entry = { ...form, amount, description: form.description.trim(), category: form.type === 'credit' ? 'Credit limit' : form.category };
  if (loan) entry.borrower = form.borrower.trim(); else delete entry.borrower;
  emit('save', entry);
  dialog.value.close();
}
defineExpose({ open });
</script>

<template>
  <dialog ref="dialog" class="edit-dialog">
    <form @submit.prevent="save">
      <div class="card-heading"><div><span class="eyebrow">{{ t(entryKinds.find(k=>k.type===form.type)?.label || 'Expenses') }}</span><h2>{{ t(form.id?'Edit transaction':entryKinds.find(k=>k.type===form.type)?.action || 'Add expense') }}</h2></div><button type="button" class="icon" :aria-label="t('Close')" @click="dialog.close()">×</button></div>
      <p class="form-note">{{ t(form.type==='credit'?'The latest limit replaces the previous limit. It is not income.':'A small entry. A clearer picture.') }}</p>
      <label v-if="form.type==='credit'">{{ t('Description') }}<select v-model="form.description" required @change="selectCreditAccount(form.description)"><option v-for="account in creditAccounts" :key="account" :value="account">{{ account }}</option><option v-if="form.description && !creditAccounts.includes(form.description)" :value="form.description">{{ form.description }}</option></select></label>
      <label v-else>{{ t('Description') }}<input v-model="form.description" required maxlength="80" :placeholder="t('e.g. Groceries')"></label>
      <div class="form-row"><label>{{ t(form.type==='credit'?'Credit limit (¥)':'Amount (¥)') }}<input v-model="form.amount" type="number" :min="form.type==='credit'?0:0.01" max="999999999" step="0.01" required placeholder="0.00"></label><label>{{ t(form.type==='credit'?'Effective date':'Date') }}<input v-model="form.date" type="date" required></label></div>
      <label v-if="form.type!=='credit'">{{ t('Category') }}<select v-model="form.category"><option v-for="item in categories" :key="item" :value="item">{{ t(item) }}</option></select></label>
      <label v-if="isLoan()">{{ t('Borrower') }}<input v-model="form.borrower" required maxlength="80" :placeholder="t('e.g. Lender')"></label>
      <label v-else>{{ t('Account') }}<select v-model="form.card" required @change="selectCard"><option v-for="card in availableCards" :key="card.id" :value="card.id">{{ t(card.name) }}<template v-if="accountLast4(card)"> · {{ t(card.network) }} •••• {{ accountLast4(card) }}</template></option></select></label>
      <button class="primary submit" type="submit">{{ t(form.id?'Save changes':'Save transaction ↗') }}</button>
    </form>
  </dialog>
</template>

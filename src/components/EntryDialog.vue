<script setup>
import { reactive, ref } from 'vue';
import { creditAccountCards, entryKinds } from '../ledger';
const props = defineProps({ cards: Array, t: Function });
const emit = defineEmits(['save']);
const dialog = ref(null);
const form = reactive({});
const categories = ['Food & Drinks','Entertainment','Utilities','Shopping','Subscription','Other','Salary'];
const loanAccount = '借款';
const creditAccounts = [...creditAccountCards.map(card => card.name), loanAccount];
const isLoan = () => form.type === 'credit' && form.description === loanAccount;
function open(type, date, entry = null) {
  const defaultCreditCard = creditAccountCards[0];
  const borrower = entry?.description === loanAccount ? entry.borrower || props.cards.find(card => card.id === entry.card)?.name || '' : '';
  Object.assign(form, { id: null, description: type === 'credit' ? defaultCreditCard.name : '', amount: '', type, category: type === 'credit' ? 'Credit limit' : type === 'income' ? 'Salary' : 'Food & Drinks', date, card: type === 'credit' ? defaultCreditCard.id : props.cards[0]?.id || '', borrower }, entry || {});
  if (type === 'credit' && form.description === loanAccount) form.borrower = borrower;
  dialog.value.showModal();
}
function selectCreditAccount(account) {
  form.card = creditAccountCards.find(card => card.name === account)?.id || '';
  if (account !== loanAccount) form.borrower = '';
}
function save() {
  const amount = Number(form.amount);
  const loan = isLoan();
  if (!Number.isFinite(amount) || (form.type === 'credit' ? amount < 0 : amount <= 0) || !form.description.trim() || (loan ? !form.borrower.trim() : !props.cards.some(card => card.id === form.card))) return;
  const creditCard = creditAccountCards.find(card => card.name === form.description);
  const entry = { ...form, card: loan ? form.card : creditCard?.id || form.card, amount, description: form.description.trim(), category: form.type === 'credit' ? 'Credit limit' : form.category };
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
      <label v-else>{{ t('Card') }}<select v-model="form.card" required><option v-for="card in cards" :key="card.id" :value="card.id">{{ t(card.name) }}<template v-if="card.last4"> · {{ t(card.network) }} •••• {{ card.last4 }}</template></option></select></label>
      <button class="primary submit" type="submit">{{ t(form.id?'Save changes':'Save transaction ↗') }}</button>
    </form>
  </dialog>
</template>

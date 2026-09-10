<script setup>
import { reactive, ref } from 'vue';
import { entryKinds } from '../ledger';
const props = defineProps({ cards: Array, t: Function });
const emit = defineEmits(['save']);
const dialog = ref(null);
const form = reactive({});
const categories = ['Food & Drinks','Entertainment','Utilities','Shopping','Subscription','Other','Salary'];
const creditAccounts = ['白条', '花呗', '美团月付', '抖音月付'];
function open(type, date, entry = null) {
  Object.assign(form, { id: null, description: type === 'credit' ? creditAccounts[0] : '', amount: '', type, category: type === 'credit' ? 'Credit limit' : type === 'income' ? 'Salary' : 'Food & Drinks', date, card: props.cards[0]?.id || '' }, entry || {});
  dialog.value.showModal();
}
function save() {
  const amount = Number(form.amount);
  if (!Number.isFinite(amount) || (form.type === 'credit' ? amount < 0 : amount <= 0) || !form.description.trim() || !props.cards.some(c => c.id === form.card)) return;
  emit('save', { ...form, amount, description: form.description.trim(), category: form.type === 'credit' ? 'Credit limit' : form.category });
  dialog.value.close();
}
defineExpose({ open });
</script>

<template>
  <dialog ref="dialog" class="edit-dialog">
    <form @submit.prevent="save">
      <div class="card-heading"><div><span class="eyebrow">{{ t(entryKinds.find(k=>k.type===form.type)?.label || 'Expenses') }}</span><h2>{{ t(form.id?'Edit transaction':entryKinds.find(k=>k.type===form.type)?.action || 'Add expense') }}</h2></div><button type="button" class="icon" :aria-label="t('Close')" @click="dialog.close()">×</button></div>
      <p class="form-note">{{ t(form.type==='credit'?'The latest limit replaces the previous limit. It is not income.':'A small entry. A clearer picture.') }}</p>
      <label v-if="form.type==='credit'">{{ t('Description') }}<select v-model="form.description" required><option v-for="account in creditAccounts" :key="account" :value="account">{{ account }}</option><option v-if="form.description && !creditAccounts.includes(form.description)" :value="form.description">{{ form.description }}</option></select></label>
      <label v-else>{{ t('Description') }}<input v-model="form.description" required maxlength="80" :placeholder="t('e.g. Groceries')"></label>
      <div class="form-row"><label>{{ t(form.type==='credit'?'Credit limit (¥)':'Amount (¥)') }}<input v-model="form.amount" type="number" :min="form.type==='credit'?0:0.01" max="999999999" step="0.01" required placeholder="0.00"></label><label>{{ t(form.type==='credit'?'Effective date':'Date') }}<input v-model="form.date" type="date" required></label></div>
      <label v-if="form.type!=='credit'">{{ t('Category') }}<select v-model="form.category"><option v-for="item in categories" :key="item" :value="item">{{ t(item) }}</option></select></label>
      <label>{{ t('Card') }}<select v-model="form.card" required><option v-for="card in cards" :key="card.id" :value="card.id">{{ t(card.name) }} · {{ card.network }} •••• {{ card.last4 }}</option></select></label>
      <button class="primary submit" type="submit">{{ t(form.id?'Save changes':'Save transaction ↗') }}</button>
    </form>
  </dialog>
</template>

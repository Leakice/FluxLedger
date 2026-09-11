<script setup>
import { computed, reactive, ref } from 'vue';
import { accountTypes, accountTypeOf, isBankAccount, accountLast4, accountProvider, isOnlineLoanAccount, loanProviders } from '../ledger';
defineProps({ t: Function });
const emit = defineEmits(['save', 'remove']);
const dialog = ref(null), form = reactive({});
const colors = ['#f4cf35','#2784f7','#8659e7','#19ac87','#ed8d60','#4c5868'];
const networks = ['Visa', 'Mastercard', '中国银行', '建设银行', '工商银行', '招商银行', '农业银行', '交通银行', '光大银行', '邮政银行', 'Other'];
const bankAccount = computed(() => isBankAccount(form));
function open(card = null) {
  for (const key of Object.keys(form)) delete form[key];
  Object.assign(form, { id: null, name: '', last4: '', noLast4: false, network: 'Visa', accountType: 'Savings card', color: colors[0] }, card || {});
  form.accountType = accountTypeOf(card || {});
  dialog.value.showModal();
}
function selectAccountType() {
  form.noLast4 = !bankAccount.value;
  if (bankAccount.value && !networks.includes(form.network)) form.network = 'Visa';
  if (isOnlineLoanAccount(form) && !loanProviders.includes(form.network)) { form.network = loanProviders[0]; selectLoanProvider(); }
}
function selectLoanProvider() {
  if (!form.name || loanProviders.includes(form.name)) form.name = form.network === 'Other' ? '' : form.network;
}
function removeCard() {
  if (!form.id) return;
  emit('remove', form.id);
  dialog.value.close();
}
function save() {
  if (!form.name.trim() || (bankAccount.value && !form.noLast4 && !/^\d{4}$/.test(form.last4))) return;
  emit('save', { ...form, accountTypeVersion: 1, name: form.name.trim(), ...(bankAccount.value ? {} : { last4: '', noLast4: true, network: accountProvider(form) }) });
  dialog.value.close();
}
defineExpose({ open });
</script>

<template>
  <dialog ref="dialog" class="edit-dialog">
    <form @submit.prevent="save">
      <div class="card-heading"><h2>{{ t(form.id?'Edit account':'Add account') }}</h2><button class="icon" type="button" :aria-label="t('Close')" @click="dialog.close()">×</button></div>
      <div class="card-preview" :style="{'--card-color':form.color}"><span>{{ t(accountProvider(form)) }}</span><strong v-if="accountLast4(form)">•••• &nbsp; •••• &nbsp; •••• &nbsp; {{ accountLast4(form) }}</strong><small>{{ form.name||t('Account name') }}</small><i>◇</i></div>
      <label>{{ t('Account name') }}<input v-model="form.name" maxlength="40" required :placeholder="t('e.g. Everyday account')"></label>
      <label>{{ t('Account type') }}<select v-model="form.accountType" @change="selectAccountType"><option v-if="form.accountType && !accountTypes.includes(form.accountType)" :value="form.accountType">{{ t(form.accountType) }}</option><option v-for="accountType in accountTypes" :key="accountType" :value="accountType">{{ t(accountType === 'Other' ? 'Other e-wallet' : accountType === 'Savings card' ? 'Bank card' : accountType) }}</option></select></label>
      <label v-if="isOnlineLoanAccount(form)">{{ t('Loan provider') }}<select v-model="form.network" @change="selectLoanProvider"><option v-if="form.network && !loanProviders.includes(form.network)" :value="form.network">{{ t(form.network) }}</option><option v-for="provider in loanProviders" :key="provider" :value="provider">{{ t(provider) }}</option></select></label>
      <p v-if="isOnlineLoanAccount(form)" class="form-note">{{ t('Online loan funding uses credit limits, not income.') }}</p>
      <div v-if="bankAccount" class="form-row"><label v-if="!form.noLast4">{{ t('Last four digits') }}<input v-model="form.last4" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required placeholder="4329"></label><label>{{ t('Bank / card network') }}<select v-model="form.network"><option v-for="network in networks" :key="network" :value="network">{{ t(network) }}</option></select></label></div>
      <label>{{ t('Account color') }}</label><div class="color-options"><button v-for="color in colors" :key="color" type="button" :style="{background:color}" :aria-label="t('Account color')+' '+color" :aria-pressed="form.color===color" :class="{selected:form.color===color}" @click="form.color=color">{{ form.color===color?'✓':'' }}</button></div>
      <p class="form-note">{{ t('Account details can change. Linked transactions stay connected.') }}</p>
      <div class="card-actions"><button v-if="form.id" class="card-delete" type="button" :aria-label="t('Delete account')" :title="t('Delete account')" @click="removeCard"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg></button><button class="primary submit card-save" type="submit">{{ t('Save account') }}</button></div>
    </form>
  </dialog>
</template>

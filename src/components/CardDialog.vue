<script setup>
import { reactive, ref } from 'vue';
defineProps({ t: Function });
const emit = defineEmits(['save']);
const dialog = ref(null), form = reactive({});
const colors = ['#f4cf35','#2784f7','#8659e7','#19ac87','#ed8d60','#4c5868'];
const networks = ['Visa', 'Mastercard', '中国银行', '建设银行', '工商银行', '招商银行', 'Other'];
function open(card = null) {
  Object.assign(form, { id: null, name: '', last4: '', network: 'Visa', color: colors[0] }, card || {});
  dialog.value.showModal();
}
function save() {
  if (!form.name.trim() || !/^\d{4}$/.test(form.last4)) return;
  emit('save', { ...form, name: form.name.trim() });
  dialog.value.close();
}
defineExpose({ open });
</script>

<template>
  <dialog ref="dialog" class="edit-dialog">
    <form @submit.prevent="save">
      <div class="card-heading"><h2>{{ t(form.id?'Edit card':'Add card') }}</h2><button class="icon" type="button" :aria-label="t('Close')" @click="dialog.close()">×</button></div>
      <div class="card-preview" :style="{'--card-color':form.color}"><span>{{ form.network }}</span><strong>•••• &nbsp; •••• &nbsp; •••• &nbsp; {{ form.last4||'0000' }}</strong><small>{{ form.name||t('Card name') }}</small><i>◇</i></div>
      <label>{{ t('Card name') }}<input v-model="form.name" maxlength="40" required :placeholder="t('Everyday card')"></label>
      <div class="form-row"><label>{{ t('Last four digits') }}<input v-model="form.last4" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required placeholder="4329"></label><label>{{ t('Card network') }}<select v-model="form.network"><option v-for="network in networks" :key="network" :value="network">{{ network }}</option></select></label></div>
      <label>{{ t('Card color') }}</label><div class="color-options"><button v-for="color in colors" :key="color" type="button" :style="{background:color}" :aria-label="t('Card color')+' '+color" :aria-pressed="form.color===color" :class="{selected:form.color===color}" @click="form.color=color">{{ form.color===color?'✓':'' }}</button></div>
      <p class="form-note">{{ t('Card details can change. Linked transactions stay connected.') }}</p>
      <button class="primary submit" type="submit">{{ t('Save card') }}</button>
    </form>
  </dialog>
</template>

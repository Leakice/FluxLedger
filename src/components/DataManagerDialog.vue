<script setup>
import { ref } from 'vue';
import { createDataBackup, parseDataFile } from '../dataTransfer';

const props = defineProps({ entries: Array, cards: Array, hiddenBuiltInCardIds: Array, t: Function });
const emit = defineEmits(['import', 'notify']);
const dialog = ref(null), fileInput = ref(null), pending = ref(null), error = ref('');

function open() {
  pending.value = null;
  error.value = '';
  if (fileInput.value) fileInput.value.value = '';
  dialog.value.showModal();
}

function exportData() {
  const backup = createDataBackup(props.entries, props.cards, new Date(), props.hiddenBuiltInCardIds);
  const url = URL.createObjectURL(new Blob([backup], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `fluxledger-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  emit('notify', 'Data exported');
}

async function chooseFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    pending.value = { ...parseDataFile(await file.text(), { cards: props.cards }), fileName: file.name };
    error.value = '';
  } catch (reason) {
    pending.value = null;
    error.value = reason instanceof Error ? reason.message : 'Could not read this file.';
    event.target.value = '';
  }
}

function importData() {
  if (!pending.value) return;
  emit('import', { entries: pending.value.entries, cards: pending.value.cards, hiddenBuiltInCardIds: pending.value.hiddenBuiltInCardIds });
  emit('notify', 'Data imported');
  dialog.value.close();
  pending.value = null;
  error.value = '';
  if (fileInput.value) fileInput.value.value = '';
}

defineExpose({ open });
</script>

<template>
  <dialog ref="dialog" class="edit-dialog data-dialog">
    <div class="card-heading">
      <div><span class="eyebrow">{{ t('Backup & restore') }}</span><h2>{{ t('Data management') }}</h2></div>
      <button type="button" class="icon" :aria-label="t('Close')" @click="dialog.close()">×</button>
    </div>
    <p class="form-note">{{ t('Move your ledger between browsers with a complete data backup.') }}</p>
    <div class="data-actions">
      <button type="button" class="data-action" @click="exportData">
        <span class="data-action-icon" aria-hidden="true">↓</span>
        <span class="data-action-copy"><strong>{{ t('Export data') }}</strong><small>{{ t('Download transactions and accounts as a JSON backup.') }}</small></span>
        <span class="data-action-arrow" aria-hidden="true">↗</span>
      </button>
      <button type="button" class="data-action" @click="fileInput.click()">
        <span class="data-action-icon import" aria-hidden="true">↑</span>
        <span class="data-action-copy"><strong>{{ t('Import data') }}</strong><small>{{ t('Restore a JSON backup or a legacy CSV export.') }}</small></span>
        <span class="data-action-arrow" aria-hidden="true">↗</span>
      </button>
      <input ref="fileInput" class="data-file-input" type="file" accept=".json,.csv,application/json,text/csv" @change="chooseFile">
    </div>
    <p v-if="error" class="data-error" role="alert">{{ t(error) }}</p>
    <div v-if="pending" class="data-import-preview">
      <div class="import-preview-heading"><strong>{{ t('Ready to import') }}</strong><small>{{ pending.fileName }}</small></div>
      <div class="import-preview-counts"><span><b>{{ pending.entries.length }}</b> {{ t('Transactions') }}</span><span><b>{{ pending.cards.length }}</b> {{ t('Accounts') }}</span></div>
      <p>{{ t('This replaces the current local data.') }}</p>
      <button type="button" class="primary submit" @click="importData">{{ t('Import and replace') }}</button>
    </div>
  </dialog>
</template>

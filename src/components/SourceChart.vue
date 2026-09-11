<script setup>
import { computed, ref, watch } from 'vue';
const props = defineProps({ sources: Array, translate: Function, money: Function });
const active = ref(null);
const colors = ['#f98224', '#408dd2', '#27a69a', '#9875c5', '#bd8c32', '#cf6d89'];
const slices = computed(() => {
  const total = props.sources.reduce((sum, item) => sum + item[1], 0);
  let start = 0;
  return props.sources.map(([name, amount], i) => {
    const fraction = total ? amount / total : 0;
    const angle = (start + fraction / 2) * Math.PI * 2 - Math.PI / 2;
    const slice = { name, amount, percent: Math.round(fraction * 100), length: fraction * 100, offset: -start * 100, color: colors[i % colors.length], x: 110 + Math.cos(angle) * 73, y: 110 + Math.sin(angle) * 73 };
    start += fraction;
    return slice;
  });
});
const selected = computed(() => slices.value[active.value]);
watch(() => props.sources, () => { active.value = null; });
</script>

<template>
  <div class="source-chart" @mouseleave="active=null" @keydown.esc="active=null">
    <div class="source-ring-wrap">
      <svg class="source-ring" viewBox="0 0 220 220" :aria-label="translate('Total')">
        <circle cx="110" cy="110" r="73" fill="none" stroke="var(--report-ring)" stroke-width="42"/>
        <circle v-for="(slice,i) in slices" :key="slice.name" class="source-slice" :class="{'is-active':active===i,'is-muted':active!==null&&active!==i}" cx="110" cy="110" r="73" pathLength="100" fill="none" :stroke="slice.color" :stroke-width="active===i?50:42" :stroke-dasharray="`${slice.length} ${100-slice.length}`" :stroke-dashoffset="slice.offset" transform="rotate(-90 110 110)" tabindex="0" role="img" :aria-label="`${translate(slice.name)} ${slice.percent}% ${money(slice.amount)}`" @mouseenter="active=i" @focus="active=i" @blur="active=null" @click="active=active===i?null:i"/>
      </svg>
      <div class="source-center"><small>{{ translate('Total') }}</small><strong>{{ sources.length }}</strong></div>
      <div v-if="selected" class="source-tooltip" role="status" :style="{left:selected.x/220*100+'%',top:selected.y/220*100+'%'}"><b>{{ translate(selected.name) }} · {{ selected.percent }}%</b><span>{{ money(selected.amount) }}</span></div>
    </div>
    <div class="source-legend">
      <button v-for="(slice,i) in slices" :key="slice.name" class="stat-row source-row" :class="{'is-active':active===i}" @mouseenter="active=i" @mouseleave="active=null" @focus="active=i" @blur="active=null" @click="active=active===i?null:i"><span><i :style="{background:slice.color}"/>{{ translate(slice.name) }}</span><b>{{ slice.percent }}%</b></button>
      <div v-if="!sources.length" class="stat-row">{{ translate('No transactions') }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
const props = defineProps({ months: Array, label: String });
const active = ref(null);
const points = computed(() => {
  const max = Math.max(...props.months.map(item => item.count), 1);
  return props.months.map((item, i) => ({ ...item, x: 24 + i * 62.4, y: 79 - item.count / max * 42 }));
});
const line = computed(() => points.value.map(point => `${point.x},${point.y}`).join(' '));
watch(() => props.months, () => { active.value = null; });
</script>

<template>
  <div id="frequency-chart" @mouseleave="active=null" @keydown.esc="active=null">
    <svg viewBox="0 0 360 110" :aria-label="label">
      <polyline class="report-line frequency-line" :class="{'is-active':active!==null}" pathLength="1" :points="line" fill="none" stroke="var(--report-accent)" stroke-width="2.6" stroke-linejoin="round"/>
      <g v-for="(point,i) in points" :key="i" class="frequency-point" :class="{'is-active':active===i}">
        <path v-if="active===i" :d="`M${point.x} 30V94`" stroke="var(--report-accent)" stroke-opacity=".3" stroke-dasharray="3 4"/>
        <circle :cx="point.x" :cy="point.y" :r="active===i?6:3" fill="var(--panel)" stroke="var(--report-accent)" stroke-width="2"/>
        <g v-if="active===i" class="frequency-tooltip" pointer-events="none"><rect :x="Math.min(264,Math.max(0,point.x-48))" y="3" width="96" height="24" rx="7"/><text :x="Math.min(312,Math.max(48,point.x))" y="19" text-anchor="middle">{{ point.label }} · {{ point.count }}</text></g>
        <rect :x="point.x-24" y="28" width="48" height="80" fill="transparent" tabindex="0" role="img" :aria-label="`${point.label}: ${point.count}`" @mouseenter="active=i" @focus="active=i" @blur="active=null" @click="active=active===i?null:i" @mousedown.prevent/>
      </g>
    </svg>
  </div>
</template>

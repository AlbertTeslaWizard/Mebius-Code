<script setup lang="ts">
import mebiusLoop from '../assets/mebius-loop.png';

withDefaults(
  defineProps<{
    size?: 'compact' | 'default' | 'hero';
    subtitle?: string;
    text?: boolean;
  }>(),
  {
    size: 'default',
    subtitle: '',
    text: true,
  },
);
</script>

<template>
  <div class="mebius-brand" :class="[`mebius-brand--${size}`, { 'mebius-brand--icon-only': !text }]">
    <div class="mebius-brand__mark" aria-hidden="true">
      <img :src="mebiusLoop" alt="" draggable="false" />
    </div>
    <div v-if="text" class="mebius-brand__copy">
      <p class="mebius-brand__name">Mebius Code</p>
      <p v-if="subtitle" class="mebius-brand__subtitle">{{ subtitle }}</p>
    </div>
  </div>
</template>

<style scoped>
.mebius-brand {
  align-items: center;
  display: inline-flex;
  gap: 0.75rem;
  min-width: 0;
}

.mebius-brand__mark {
  aspect-ratio: 1672 / 941;
  background: #140603;
  border: 1px solid rgb(255 179 71 / 45%);
  border-radius: 7px;
  box-shadow:
    0 0 0 1px rgb(15 23 42 / 4%),
    0 8px 22px rgb(234 88 12 / 16%);
  flex: 0 0 auto;
  overflow: hidden;
  position: relative;
  width: 54px;
}

.mebius-brand__mark::after {
  background: linear-gradient(110deg, rgb(255 255 255 / 18%), transparent 36%, rgb(255 255 255 / 10%));
  content: "";
  inset: 0;
  pointer-events: none;
  position: absolute;
}

.mebius-brand__mark img {
  display: block;
  height: 100%;
  object-fit: cover;
  width: 100%;
}

.mebius-brand__copy {
  min-width: 0;
}

.mebius-brand__name {
  color: #0f172a;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.15;
  margin: 0;
}

.mebius-brand__subtitle {
  color: #667085;
  font-size: 12px;
  line-height: 1.35;
  margin: 0.2rem 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mebius-brand--compact {
  gap: 0.55rem;
}

.mebius-brand--compact .mebius-brand__mark {
  width: 42px;
}

.mebius-brand--compact .mebius-brand__name {
  font-size: 14px;
}

.mebius-brand--compact .mebius-brand__subtitle {
  font-size: 11px;
}

.mebius-brand--hero {
  align-items: flex-start;
  display: flex;
  gap: 1rem;
}

.mebius-brand--hero .mebius-brand__mark {
  border-radius: 8px;
  box-shadow:
    0 0 0 1px rgb(15 23 42 / 5%),
    0 18px 42px rgb(234 88 12 / 22%);
  width: 104px;
}

.mebius-brand--hero .mebius-brand__name {
  font-size: 24px;
}

.mebius-brand--hero .mebius-brand__subtitle {
  font-size: 14px;
  margin-top: 0.35rem;
}

.mebius-brand--icon-only {
  gap: 0;
}

@media (max-width: 520px) {
  .mebius-brand--hero {
    align-items: center;
  }

  .mebius-brand--hero .mebius-brand__mark {
    width: 78px;
  }

  .mebius-brand--hero .mebius-brand__name {
    font-size: 20px;
  }
}
</style>

<template>
  <section>
    <!-- {{ $t('commented.key') }} -->
    <h1>{{ $t('app.title') }}</h1>
    <p v-if="empty" v-t="'cart.empty'"></p>
    <p :title="$t('cart.total', { amount })">{{ $tc('cart.items', count) }}</p>
    <i18n-t keypath="app.greeting" tag="span">
      <template #name><b>{{ user }}</b></template>
    </i18n-t>
    <button>{{ $t(`cart.${action}`) }}</button>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const about = t('about');
const missing = t('cart.discount');
defineProps<{ empty: boolean; amount: string; count: number; user: string; action: string }>();
</script>

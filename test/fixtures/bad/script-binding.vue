<!--
  解构绑定的写法：`const { target } = e` 之后再读 `target.value`。
  与 script-destructured.vue 是同一条性质的另一种拼法 ——
  规则钉的是性质（值从 target 上来），不是某一种写法。
-->
<template>
  <switch :checked="on" @change="onToggle" />
</template>

<script setup lang="ts">
import { ref } from 'vue';

const on = ref(false);

function onToggle(e: unknown): void {
  const { target } = e as { target?: { value?: boolean } };
  on.value = Boolean(target?.value);
}
</script>

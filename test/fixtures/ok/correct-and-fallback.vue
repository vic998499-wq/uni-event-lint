<!--
  两种**正确**写法，一条都不该报。

  1. 直接读 `detail.value` —— 标准写法。
  2. 「先 detail，读不到才兜底 target」—— 也是对的，而且在真实代码里很常见
     （跨端兼容的写法）。判据是「同一个函数里也读了 detail」，
     不是「往上三行内出现过 detail」：三行窗口会被 formatter 一换行就漂掉，
     函数边界不会。

  ⚠️ 少了这个夹具，规则会把所有兜底写法都报成红的 ——
  那种工具装上第一天就会被关掉。
-->
<template>
  <view>
    <input :value="keyword" @input="onSearch" />
    <input :value="address" @input="onAddress" />
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const keyword = ref('');
const address = ref('');

/** 标准写法。 */
function onSearch(e: unknown): void {
  const detail = (e as { detail?: { value?: string } })?.detail;
  keyword.value = typeof detail?.value === 'string' ? detail.value : '';
}

/** 先 detail、读不到才兜底 target —— 合法的跨端兜底。 */
function onAddress(e: unknown): void {
  const detail = (e as { detail?: { value?: string } })?.detail;
  address.value =
    typeof detail?.value === 'string'
      ? detail.value
      : ((e as { target?: { value?: string } })?.target?.value ?? '');
}
</script>

<!--
  🔴 **这个夹具是本工具存在的理由之一。**

  它的前身（一道在生产仓里跑了半年的结构门）要求 `target` 和 `value`
  **写在同一行**才报。于是下面这种写法 —— 先把 target 存进局部变量、换行再读 value ——
  **穿过去了**：门 9/9 全绿，而它守的正是这个 bug。

  两次访问被一个局部变量拆开，`target` 再也不和 `value` 同行。
  ⇒ 所以本工具不靠「写在一起」这种形状，而是**跨一层局部变量追**。

  少了这条用例，把规则改回「同一行」不会红。
-->
<template>
  <textarea :value="text" @input="onInput" />
</template>

<script setup lang="ts">
import { ref } from 'vue';

const text = ref('');

/** 和 template-inline.vue 语义完全相同，只是拆成了两次访问。 */
function readInputValue(e: unknown): string {
  const d = (e as { target?: { value?: string } })?.target;
  return typeof d?.value === 'string' ? d.value : '';
}

function onInput(e: unknown): void {
  text.value = readInputValue(e);
}
</script>

<!--
  两种不该报的情形：

  1. **`#ifdef H5` 里的原生 DOM** —— 那是真的 `<input type="file">`，
     `event.target` 是真 DOM 元素，`.value` / `.files` 都有。
     小程序端走另一条 `uni.chooseMessageFile` 路径，这段根本不编译进去。
     真实来历：一个施工管理小程序的设备附件上传。

  2. **`currentTarget`** —— 不是 `target`，而且它上面确实有 dataset。
     规则按属性名精确匹配（大写 T 不匹配小写 target），这条钉住这件事。
-->
<template>
  <view>
    <!-- #ifdef H5 -->
    <input type="file" @change="onPickAttachment" />
    <!-- #endif -->
    <view :data-id="1" @tap="onTapItem">点我</view>
  </view>
</template>

<script setup lang="ts">
// #ifdef H5
async function onPickAttachment(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  // 上传完清空，好让同一个文件能再选一次
  input.value = '';
}
// #endif

function onTapItem(e: unknown): void {
  const id = (e as { currentTarget?: { dataset?: { id?: number } } })?.currentTarget?.dataset?.id;
  console.log(id);
}
</script>

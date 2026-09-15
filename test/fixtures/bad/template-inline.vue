<!--
  真实来历：一个施工管理小程序的「甲方拒签特批」表单，2026-05 写下，
  2026-09 才被真实页面上的探针坐实 —— 中间发过一版小程序包。

  症状：用户在文本框里打了字，`refuseReason` 恒为空串，点提交被自己的必填校验挡住，
  页面上**一个错都不报**。

  ⭐ 注意 `as HTMLTextAreaElement` —— 那个断言就是 bug 本身：
  开发者告诉 TypeScript「它是原生元素」，TS 信了，于是类型检查也全绿。
-->
<template>
  <view class="refuse">
    <textarea
      :value="refuseReason"
      placeholder="请填写拒签原因"
      @input="setRefuseReason(($event.target as HTMLTextAreaElement)?.value ?? '')"
    />
    <button @click="submit">提交</button>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const refuseReason = ref<string>('');

function setRefuseReason(value: string): void {
  refuseReason.value = value;
}

function submit(): void {
  if (!refuseReason.value.trim()) {
    uni.showToast({ title: '请填写拒签原因', icon: 'none' });
    return;
  }
}
</script>

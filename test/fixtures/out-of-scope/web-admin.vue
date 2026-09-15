<!--
  🔴 **这是网页 Vue，不是 uni-app** —— 本目录**刻意没有 `pages.json`**。

  在网页 Vue 里 `event.target.value` 是**完全正确**的写法：那是真 DOM 元素。
  本工具必须**一条都不报**，连扫都不该扫它。

  真实来历：基线率采集时有个仓报了 6 条，全在 `admin/src/components/MDinput`、
  `dashboard/admin/components/TodoList` 下 —— 那是 vue-element-admin 的网页后台。
  很多仓是「网页后台 + uni-app 前端」并存，只看 .vue 后缀分不开。
  加上 `pages.json` 作用域判定之后，那 6 条降到 0。

  ⚠️ 这个夹具钉的是「**别去扫不归你管的代码**」——
  一个乱报的 linter 的下场是被 `--no-verify` 绕过去，然后再也没人开。
-->
<template>
  <div class="md-input">
    <input :value="value" @input="handleInput" />
  </div>
</template>

<script>
export default {
  name: 'MDinput',
  props: { value: { type: String, default: '' } },
  methods: {
    handleInput(event) {
      // 网页 Vue：这是对的
      const value = event.target.value;
      this.$emit('input', value);
    },
  },
};
</script>

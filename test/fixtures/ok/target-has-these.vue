<!--
  🔴 **target 上不是什么都没有** —— 它有 `{ id, dataset, offsetTop, offsetLeft }`，
  缺的**只有 `value`**。所以下面这些读法**完全合法**，一条都不该报。

  真实来历：本工具的第一版对「碰了 `.target` 就报」，拿去扫 3 个真实开源仓，
  **7 条 HIGH 里 6 条是误报**，其中 4 条就是下面这两种
  （`e.target.dataset.src` ×3、`e.target.id` ×1）。

  还有 2 条是 `uni.createSelectorQuery().select('.target')` ——
  那是个 **CSS 选择器字符串**，根本不是属性访问。也在下面。
-->
<template>
  <view>
    <image
      v-for="src in list"
      :key="src"
      :src="src"
      :data-src="src"
      @tap="preview"
    />
    <view class="target" />
  </view>
</template>

<script>
export default {
  data() {
    return { list: [], nodeId: '' };
  },
  methods: {
    // dataset 在 target 上，合法
    preview(e) {
      const current = e.target.dataset.src;
      uni.previewImage({ current, urls: this.list });
    },
    // id 也在 target 上，合法
    remember(e) {
      this.nodeId = e.target.id;
    },
    // 这是 CSS 选择器字符串，不是属性访问
    measure() {
      uni.createSelectorQuery().select('.target').boundingClientRect().exec();
    },
  },
};
</script>

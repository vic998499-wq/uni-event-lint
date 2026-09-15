<!--
  真实来历：一个 1700+★ 商城模板的「个人资料」页（生日选了存不进去）。

  ⭐ 这个夹具的重点是**紧挨着的两个方法，一个写对一个写错** ——
  同一个人、同一个文件里知道值在 `detail`，隔壁还是写了 `target`。
  这个 bug 的成因不是「不知道」，是「不一致」。

  同款在另外两个仓里逐字复现过（一个 3000+★ 的商城、一个个人商城项目）。
-->
<template>
  <view>
    <picker mode="date" :value="date" @change="bindDateChange">
      <view class="cell">{{ date || '请选择生日' }}</view>
    </picker>

    <radio-group @change="handleGenderChange">
      <label><radio value="1" />男</label>
      <label><radio value="2" />女</label>
    </radio-group>
  </view>
</template>

<script>
export default {
  data() {
    return { date: '', gender: '' };
  },
  methods: {
    // 🔴 错的那个：picker 的值在 detail.value，target 上没有
    bindDateChange(e) {
      this.date = e.target.value;
    },
    // ✅ 对的那个 —— 就在隔壁
    handleGenderChange(e) {
      this.gender = e.detail.value;
    },
  },
};
</script>

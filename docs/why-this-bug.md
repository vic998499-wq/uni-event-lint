# 这个 bug 的机制：为什么 `e.target.value` 在 uni-app 里恒空

## 一句话

uni 的 `<input>` / `<textarea>` / `<picker>` / `<switch>` **两端都不是原生元素**，
它们 emit 的事件对象里 `target` 只有

```js
{ id, dataset, offsetTop, offsetLeft }
```

**没有 `value`**。值在 `detail.value` 里。

## 为什么两端都这样

| 端 | `<input>` 编译成什么 | `target` 是什么 |
|---|---|---|
| H5 | `uni-h5` 的 `Input` **组件** | 组件自己构造的事件对象 |
| 微信小程序 | 原生 `input` **组件** | 小程序框架构造的事件对象 |

两边都不是浏览器的 `HTMLInputElement`，所以两边都没有 `.value`。

写成 `e.target.value` 的结果是 `undefined`：

```js
// 用户打了字
onInput(e) {
  this.keyword = e.target.value   // undefined
}
// this.keyword 恒为 undefined
// 页面上一个错都不报
```

## 🔴 为什么单元测试挡不住它

这是最要命的一点，也是本工具存在的理由。

`vitest` / `jest` 跑在 **jsdom** 里。要让 `<input>` 变成 uni 组件，得挂
`vite-plugin-uni` 那一整套编译期插件 —— 绝大多数项目的测试配置**没有挂**
（挂上去风险面是整个测试集）。

于是测试里的 `<input>` 是**原生 DOM 元素**：

```js
// 用例里
await wrapper.find('input').setValue('abc')
// jsdom 的 input 是真 HTMLInputElement，target.value === 'abc'
expect(vm.keyword).toBe('abc')   // ✅ 绿的
```

**错的写法在用例里恒绿。** 而且：

- TypeScript 也拦不住 —— 开发者常写 `($event.target as HTMLTextAreaElement).value`，
  那个断言就是 bug 本身：**你告诉 TS 它是原生元素，TS 就信了。**
- VTU 的 `stubs` 对合法 HTML 标签不生效，换不掉。

⇒ 只有**读源码**能发现它。

## 它长什么样（四种真实拼法）

```vue
<!-- ① 模板内联 —— 最常见 -->
<textarea @input="set(($event.target as HTMLTextAreaElement)?.value ?? '')" />
```

```js
// ② 直写
bindDateChange(e) { this.date = e.target.value }

// ③ 拆成两次访问（本工具前身漏掉的就是它）
function readInputValue(e) {
  const d = e?.target
  return typeof d?.value === 'string' ? d.value : ''
}

// ④ 解构绑定
const { target } = e
on.value = Boolean(target?.value)
```

## ⚠️ `target` 上**不是**什么都没有

这些读法**完全合法**，本工具不报：

```js
e.target.dataset.src   // ✅ dataset 在 target 上
e.target.id            // ✅ id 也在
e.currentTarget.dataset // ✅ 另一个属性
uni.createSelectorQuery().select('.target')  // ✅ 这是 CSS 选择器字符串
```

缺的**只有 `value`**。本工具的第一版对「碰了 `.target` 就报」，
拿去扫 3 个真实开源仓，**7 条里 6 条是误报**，全是上面这几种。

## 合法的兜底写法

跨端兼容时这样写是对的，本工具降档为 `INFO` 不报红：

```js
function readValue(e) {
  const detail = e?.detail
  return typeof detail?.value === 'string'
    ? detail.value
    : (e?.target?.value ?? '')   // 先 detail，读不到才兜底
}
```

## 修法

改读 `e.detail.value`。就这一句。

```diff
- this.date = e.target.value
+ this.date = e.detail.value
```

## 一个真实的样本

某商城模板的个人资料页，**紧挨着的两个方法**：

```js
bindDateChange(e)     { this.date = e.target.value }                // 🔴 生日存不进去
handleGenderChange(e) { this.profileInfo.gender = e.detail.value }  // ✅ 性别正常
```

同一个人、同一个文件里知道值在 `detail`，隔壁还是写了 `target`。

**这个 bug 的成因不是「不知道」，是「不一致」。** 所以它值得一道自动的闸。

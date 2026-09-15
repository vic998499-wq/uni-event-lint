# uni-event-lint

**找出 uni-app 里「从事件的 `target` 取 `value`」这类写法** —— 页面不报错、TypeScript 不报错、**单元测试也照样绿**的那一类 bug。

```bash
npx uni-event-lint ./src
```

```
uni-event-lint  扫描 ./src
  .vue 113 个 | HIGH 1 · INFO 0 · SKIP 0

  🔴 pages/user/userinfo/userinfo.vue:190  [script-target-value]
     this.date = e.target.value;
     ⇒ 直接从事件的 target 上读 value

  修法：改读 `e.detail.value`。
```

---

## 它找的是什么

uni 的 `<input>` / `<textarea>` / `<picker>` / `<switch>` **两端都不是原生元素** ——
H5 编成 `uni-h5` 组件、小程序编成原生组件。两边 emit 的事件里，`target` 只有

```js
{ id, dataset, offsetTop, offsetLeft }   // ← 没有 value
```

值在 **`detail.value`**。写成 `e.target.value` 就是 `undefined`，绑定的变量恒为空。

**而页面上一个错都不报。** 用户看着自己填的内容，点提交却被自己的必填校验挡住。

### 🔴 为什么单元测试挡不住它

`vitest` / `jest` 跑在 jsdom 里。要让 `<input>` 变成 uni 组件得挂 `vite-plugin-uni`
那一整套编译期插件 —— 绝大多数项目的测试配置**没有挂**。

于是用例里的 `<input>` 是**原生 DOM 元素**，`target.value` 真的有值：

```js
await wrapper.find('input').setValue('abc')
expect(vm.keyword).toBe('abc')     // ✅ 绿的，但线上是空的
```

TypeScript 也拦不住 —— 最常见的写法正是

```ts
@input="set(($event.target as HTMLTextAreaElement)?.value ?? '')"
```

**那个 `as` 断言就是 bug 本身**：你告诉 TS 它是原生元素，TS 就信了。

⇒ **只有读源码能发现它。**

机制细节见 [`docs/why-this-bug.md`](docs/why-this-bug.md)。

## 用法

```bash
# 直接跑，不用装
npx uni-event-lint ./src

# 或者装进项目
npm i -D uni-event-lint
npx uni-event-lint ./src
```

| 选项 | 作用 |
|---|---|
| `--json` | 输出 JSON，给 CI / 别的工具用 |
| `--quiet` | 只打 `HIGH` |
| `--exit-zero` | 有命中也返回 0（想先看看、暂不卡 CI） |

退出码：有 `HIGH` 返回 `1`，否则 `0`。

接 CI：

```yaml
- run: npx uni-event-lint ./src
```

## 它报什么、不报什么

| 档 | 含义 |
|---|---|
| 🔴 `HIGH` | 从 uni 组件事件的 `target` 上取 `value` —— 几乎一定是这个 bug |
| `INFO` | 同一个函数里也读了 `detail` —— 合法的「先 detail，读不到才兜底」 |
| `SKIP` | 附近有原生 DOM 信号（`HTMLInputElement` / `.files`）—— 可能真是 DOM |
| ⚠️ `PARSE` | 这个 `<script>` 块没干净解析 —— **它报出的 0 命中不可信** |

**`target` 上不是什么都没有。** 这些读法完全合法，不报：

```js
e.target.dataset.src                          // ✅
e.target.id                                   // ✅
e.currentTarget.dataset                       // ✅
uni.createSelectorQuery().select('.target')   // ✅ 这是 CSS 选择器字符串
```

缺的**只有 `value`**。

**只在 uni-app 作用域内报** —— 祖先目录里要有 `pages.json` 或 `pages.config.*`。
很多仓是「网页后台 + uni-app 前端」并存，而**在网页 Vue 里 `event.target.value` 完全正确**。

## 我扫了 30 个 uni-app 仓

取样规则先定死、**顺序全取、不挑**：GitHub `topic:uni-app ∪ topic:uniapp` +
`language:Vue`，按 star 降序取前 30。

```
实际扫到          29 个仓（1 个 .vue < 10，不适用）
                  3,521 个在 uni-app 作用域内的 .vue

至少一条真 bug     4 / 29 = 13.8%
其中「活的」       3 / 29 = 10.3%   （另一个是死代码，handler 没绑上）
误报               0 / 29           （18 条命中逐条人工核实）
```

命中的 4 个仓，逐条核实过：

| 仓 | ★ | 条数 | 核实结论 |
|---|---|---|---|
| [ThorUI-uniapp](https://github.com/dingyong0214/ThorUI-uniapp) | 2.8k | 12 | ✅ `<switch @change>` 读 `target.value` —— 裁剪演示页 5 个开关**拨了不起作用** |
| [crmeb_java](https://github.com/crmeb/crmeb_java) | 3.0k | 3 | 🟡 写法真错，但那个 handler 模板里没绑（死代码） |
| [TinyShop-UniApp](https://github.com/stavyan/TinyShop-UniApp) | 1.8k | 1 | ✅ `<picker mode="date">` —— 个人资料的**生日存不进去** |
| [uniapp-admin](https://github.com/lavieAll/uniapp-admin) | 393 | 2 | ✅ 登录输入组件 `$emit('input', undefined)`；深色模式开关无效 |

完整 30 行数据和方法见 [`docs/survey-2026-09.md`](docs/survey-2026-09.md)。

⭐ **4 个里有 3 个是同一个形状：紧挨着的两个方法，一个写对一个写错。**

```js
// TinyShop  pages/user/userinfo/userinfo.vue
bindDateChange(e)     { this.date = e.target.value }                // 🔴
handleGenderChange(e) { this.profileInfo.gender = e.detail.value }  // ✅
```

**这个 bug 的成因不是「不知道」，是「不一致」** —— 同一个人、同一个文件里知道值在
`detail`，隔壁还是写了 `target`。所以它值得一道自动的闸。

## 它守不住什么

写清楚，免得你照着一句错的自述判覆盖面：

- **跨函数传递**：`f(e.target)` 然后在 `f` 里读 `.value` —— 看不见。
- **存进对象/数组再取出来** —— 看不见。
- **把 `detail` 读成别的名字再用** —— 那类改写不在射程内。
- **认不出的形状一律不报**。这是刻意的：给别人用的工具，
  **误报的代价是被关掉，漏报的代价只是少帮一次。**

## 这个工具自己被打掉过几次

它不是一次写对的。每一条都留了用例，改回去就红：

| # | 它曾经错在哪 | 怎么发现的 |
|---|---|---|
| 1 | 对「碰了 `.target` 就报」 | 扫 3 个真实仓，**7 条里 6 条误报**（`dataset` / `id` / CSS 选择器字符串） |
| 2 | 收窄后要求 `target` 和 `value` **写在同一行** | `const d = e.target;` 换行再 `d.value` 就穿过去 —— 它的前身正是这么被打掉的 |
| 3 | 不分 uni-app / 网页 Vue | 某个仓 6 条全在 `vue-element-admin` 的网页后台里，**那儿 `target.value` 是对的** |
| 4 | `ts.createSourceFile` 语法错**不抛异常** | 被解析坏的文件**静默返回 0 命中** ⇒ 加了 `PARSE` 档，一个仓当场露出 1 个假零 |
| 5 | 跳过目录列表里有 `static` | 某仓 uni-app 源码在 Spring Boot 的 `resources/static/` 下 ⇒ **169 个文件一个没扫，报了个 0** |
| 6 | 只认 `pages.json` 作作用域标志 | 现代模板（unibest 那一系）的 `pages.json` 是**自动生成 + gitignore** 的 ⇒ 又两个仓被整个排除 |
| 7 | 判「有没有 detail 兜底」时没剥注释 | **在出 bug 的 handler 上面写一句提到 `detail` 的注释，就能让规则闭嘴** |

第 4、5、6 条都是同一类：**「0 命中」说不清是哪一种 0。** 所以本工具坚持把
「扫了几个文件 / 排除了几个 / 解析干不干净」和结果一起打出来 —— 一个不说清楚的
0，和一个真正干净的 0，长得一模一样。

## 开发

```bash
npm install
npm test        # 17 条，零测试框架依赖（node:test）
```

用例里 `test/fixtures/bad/` 每一个文件都对应一种真实拼法，
`test/fixtures/ok/` 每一个都对应一次**真实发生过的误报**。

## License

MIT

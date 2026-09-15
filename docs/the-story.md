# 我写了个 linter，它错了七次

> 这是 [uni-event-lint](https://github.com/vic998499-wq/uni-event-lint) 的来历。
> 每一次"它错了"都有数字和用例，不是回忆。

## 一、先看这行代码

```vue
<textarea @input="set(($event.target as HTMLTextAreaElement)?.value ?? '')" />
```

它在 uni-app 里**恒取到 `undefined`**。

uni 的 `<input>` / `<textarea>` / `<picker>` / `<switch>` 两端都不是原生元素 ——
H5 编成 `uni-h5` 组件、小程序编成原生组件。两边 emit 的事件里，`target` 只有

```js
{ id, dataset, offsetTop, offsetLeft }   // 没有 value
```

值在 `detail.value`。

所以上面那行的结果是：用户打了字，绑定的变量恒为空串，点提交被自己的必填校验挡住，
**页面上一个错都不报**。

⭐ 最毒的是 `as HTMLTextAreaElement` 那个断言 —— **它本身就是 bug**。
你告诉 TypeScript「这是个原生元素」，TS 就信了，于是类型检查全绿。

### 单元测试也挡不住

`vitest` / `jest` 跑在 jsdom 里。要让 `<input>` 变成 uni 组件，得挂 `vite-plugin-uni`
那一整套编译期插件 —— 绝大多数项目的测试配置**没挂**（挂上去风险面是整个测试集）。

于是用例里的 `<input>` 是**原生 DOM 元素**，`target.value` 真的有值：

```js
await wrapper.find('textarea').setValue('abc')
expect(vm.reason).toBe('abc')     // ✅ 绿的。线上是空的。
```

**页面不报错 + TypeScript 不报错 + 单元测试恒绿。** 三道网，一条鱼都没拦住。

这个 bug 在我一个真实的生产项目里活了四个月，中间还发过一版小程序包。
发现它的不是任何一道闸，是有人在真机上点了一次"提交"。

## 二、我以为我有现成答案

修完之后我加了一道结构门：扫所有 `.vue`，**碰了 `.target` 就必须在登记表里有名有姓**。
它在那个仓里跑了半年，稳得很。

几个月后我想：这规则对所有 uni-app 项目都成立，抄出来开源吧。

抄出来，扫了 3 个真实开源仓（353 个 `.vue`）：

```
7 条 HIGH —— 6 条是误报
```

- `e.target.dataset.src` ×3 —— **合法**，`dataset` 就在 `target` 上
- `e.target.id` ×1 —— **合法**，`id` 也在
- `uni.createSelectorQuery().select('.target')` ×2 —— 那是个 **CSS 选择器字符串**

`target` 上不是什么都没有，**缺的只有 `value`**。

### 那道门为什么在我仓里是对的

因为它背后有一张**登记表**。过度捕捉完全没问题 —— 人登记一次，往后多一条少一条都红。

**但公开的 linter 不能带登记表。** 别人装上它，看到 6 条误报，第二天就关掉了。

> 一个判据在"我自己维护的仓"里成立，不等于它在"别人的仓"里成立。
> 差别不在规则，在规则背后有没有一个人。

## 三、收窄，然后又漏

于是收窄：不是"碰了 `.target`"，而是"**从 `target` 上取 `value`**"。

误报清零了。然后我给它配阳性对照 —— 把那个真 bug 的语义重新写一遍，看它报不报：

```js
function readInputValue(e) {
  const d = e?.target          // ← 先存进局部变量
  return typeof d?.value === 'string' ? d.value : ''   // ← 换行再读 value
}
```

**穿过去了。**

因为收窄之后的规则要求 `target` 和 `value` 写在**同一行**。局部变量把两次访问拆开，
它就看不见了。

⚠️ 而这**正是它前身被打掉的方式** —— 那道跑了半年的门，也是栽在"必须同行"上。
我把同一个错误又犯了一遍，只是换了个地方。

最后的规则是**跨一层局部变量追**：先找出绑定自 `.target` 的标识符，再看谁从它读 `value`。
这不是正则能干的事，所以走了 TypeScript 的 AST。

## 四、这东西到底值不值得做

规则对了，下一个问题是：**真实项目里到底有多少人这么写？**

取样规则先定死，**顺序全取，不挑** —— GitHub `topic:uni-app ∪ uniapp` + `language:Vue`，
按 star 降序取前 30。预期干净的也要进样本，否则这个数没有意义。

结果：

```
29 个仓扫到（1 个 .vue < 10，不适用）
3,521 个在 uni-app 作用域内的 .vue

至少一条真 bug   4 / 29 = 13.8%
其中「活的」     3 / 29 = 10.3%
误报             0 / 29
```

命中的，逐条人工核对过绑定：

| 仓 | ★ | 症状 |
|---|---|---|
| ThorUI-uniapp | 2.8k | 12 处 `<switch @change>` —— 裁剪演示页的开关**拨了不起作用** |
| TinyShop-UniApp | 1.8k | `<picker mode="date">` —— 个人资料的**生日存不进去** |
| uniapp-admin | 393 | 登录输入组件 `$emit('input', undefined)` |
| crmeb_java | 3.0k | 写法真错，但那个 handler 没绑上（死代码） |

⭐ **4 个里有 3 个是同一个形状 —— 紧挨着的两个方法，一个写对一个写错：**

```js
// TinyShop  userinfo.vue
bindDateChange(e)     { this.date = e.target.value }                // 🔴
handleGenderChange(e) { this.profileInfo.gender = e.detail.value }  // ✅

// CRMEB  user_cash/index.vue
function bindPickerChange(e) { index.value = e.detail.value }       // ✅
function moneyInput(e)       { money.value = e.target.value }       // 🔴
const subCash = Debounce(function(e) { let value = e.detail.value   // ✅
```

同一个人、同一个文件里知道值在 `detail`，隔壁还是写了 `target`。

**这个 bug 的成因不是「不知道」，是「不一致」。** 而"不一致"恰恰是人治不了、机器能治的那一类。

## 五、采集这 30 个数字的过程里，我拿到过五个假读数

这一节才是我真正想写的。**没有一次是"跑一遍就得到数字"** —— 每次都是先量出一个看着
很合理的数，再发现那个数是编的。

### ① 网页 Vue 混在同一个仓里

某个仓报了 6 条，全在 `admin/src/components/MDinput`、
`dashboard/admin/components/TodoList` 下面。

那是 **vue-element-admin 的网页后台**。**在网页 Vue 里 `event.target.value` 完全正确。**

很多仓是「后台网页 + uni-app 前端」并存，只看 `.vue` 后缀分不开。
加了作用域判定（祖先目录里要有 `pages.json`）之后，6 条降到 0。

### ② 解析器骗了我，而且不出声

`ts.createSourceFile()` **遇到语法错误不抛异常** —— 它造一棵带错误节点的树继续跑。

所以「没抛异常」证明不了「解析对了」：一个被解析坏的文件会**静默返回 0 命中**。
而 0 命中正是这个工具最常见的输出。

加了一条 `parseDiagnostics` 的统计之后，一个仓当场露出 1 个假零。

### ③ 我的跳过列表吃掉了一整个仓

某个仓报「`.vue` 0 个」。但同一行还写着「**有输入事件的文件 19 个**」。

自相矛盾。查下去：那个仓的 uni-app 源码在
`src/main/resources/**static**/xxx-uniapp/` 下面 —— 那是 **Spring Boot 的资源目录**，
不是 uni-app 的静态资源目录。而我的跳过列表里有 `static`。

**169 个文件一个没扫，报了个 0。**

揪出它的是那一列**分母**。没有分母，这就是一个完全看不出来的假零。

> 跳过目录只省时间，**跳错就是错**。名字太通用的一律别跳。

### ④ `pages.json` 是自动生成的

修完 ③ 之后，还有两个仓报 0。

现代 uni-app 模板（unibest 那一系）用 `@uni-helper/vite-plugin-uni-pages`，
`pages.json` 是**自动生成的，而且写在 `.gitignore` 里**。仓里根本没有这个文件。

我的作用域判定只认 `pages.json` ⇒ 整仓排除，再报一个 0。

### ⑤ tar 把 `C:/` 当成了远程主机

采集脚本里解压老是失败。手动跑同样的命令 —— **成功**。

最后把 stderr 露出来才看见：

```
tar (child): Cannot connect to C: resolve failed
```

GNU tar 把 `C:/Users/...` 解释成**远程主机规格 `host:path`**，在试图连接一台叫 `C` 的机器。

**而我手动验证时用的是 POSIX 形式 `/c/Users/...`** —— 所以那次"成功"了，
给了我一个自洽的错答案。

> 验证面少复现一条真实条件（这里是路径形式），量出来的每个数都是假的。

### ⑥ 最丢人的一个：我自己把数据搅坏了

第一轮采集跑到一半，我想改脚本，就把它停掉了。

**它没停掉。** bash 的 `while` 循环还在跑。而我在它底下**重写了那个脚本文件** ——
bash 是边读边执行的，它读到新内容当场语法错。更糟的是两个实例**共用同一个克隆目录**，
互相删对方刚下载的仓。

产出是一张 **58 行、27 个仓重复、9 列和 10 列混在一起**的表。

**它看着像数据。** 如果我没去核对行数和重复项，那个基线率就会被我当成事实写出来。

全部作废重采，并给脚本加了单实例锁（锁本身也验过：第二个实例被拒绝启动）。

## 六、贯穿这五个假读数的是同一件事

③④⑤ 和 ② 是同一类：

> **「0 命中」说不清是哪一种 0。**
>
> 是真的写对了？是一个文件都没扫到？是全被判成不在作用域？还是解析器根本没看懂？
>
> **这四种 0，长得一模一样。**

所以这个工具现在坚持把它们一起打出来：

```
.vue 113 个（另有 416 个不在 uni-app 作用域，已排除）| HIGH 1 · INFO 0 · SKIP 0 · ⚠️ 解析不干净 1
```

扫了几个、排除了几个、解析干不干净 —— 这些数字跟结果一样重要。
**一个不说清楚的 0，比一个红色的报错危险得多，因为它长得像好消息。**

## 七、然后它又错了第七次

工具写完、测试写完，我建了几个夹具。其中一个是这样的：

```js
methods: {
  // 🔴 错的那个：picker 的值在 detail.value，target 上没有
  bindDateChange(e) {
    this.date = e.target.value;
  },
}
```

**没报出来。**

因为规则里有一条：如果同一个函数里也读了 `detail`，就认为是「先 detail、读不到才兜底」
的合法写法，降档不报。而我用 `node.pos` 取函数文本 —— **`pos` 包含前导注释**。

上面那行注释里有「`detail.value`」。

⇒ **在一个出 bug 的 handler 上面写一句提到 `detail` 的注释，就能让规则对它闭嘴。**

修法是判之前先剥注释。改回去，恰好一条用例红并点名文件。

## 八、所以

工具在这里：**https://github.com/vic998499-wq/uni-event-lint**

```bash
npx uni-event-lint ./src
```

`README` 里有那张 30 仓的表，`docs/survey-2026-09.md` 有完整数据和方法，
`test/fixtures/ok/` 里每一个文件都对应**一次真实发生过的误报**。

如果它在你的项目里扫出了东西，我很想知道 —— 那是这个工具唯一有意义的判据。
如果它误报了，更想知道。

---

**最后一句私货。**

这七次里，没有一次是被"代码写错了"抓住的。抓住它们的是：

- 一个**分母**（「.vue 0 个却有 19 个文件在处理输入事件」）
- 一个**阳性对照**（「把真 bug 重新写一遍，它报不报？」）
- 一次**数行数**（「30 个仓怎么会有 58 行？」）

写判据比写实现难。因为实现错了会报错，**判据错了会绿**。

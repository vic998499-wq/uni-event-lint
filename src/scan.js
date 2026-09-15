import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * uni-app 事件取值检查器 —— 规则本体。
 *
 * ## 它找的是什么
 *
 * uni 的 `<input>` / `<textarea>` / `<picker>` / `<switch>` 等**不是原生元素**：
 * H5 编成 uni-h5 组件、小程序编成原生组件。两端 emit 的事件里，`target` 只有
 * `{ id, dataset, offsetTop, offsetLeft }` —— **没有 `value`**。值在 `detail.value`。
 *
 * 写成 `e.target.value` 的后果是取到 `undefined`，绑定的变量恒为空，
 * 而**页面上一个错都不报**。用户看着自己填的内容，点提交却被自己的必填校验挡住。
 *
 * ⚠️ **单元测试挡不住它**：vitest / jest 跑在 jsdom 里，`<input>` 是**原生 DOM 元素**，
 * `target.value` 真的有值 ⇒ **错的写法在用例里恒绿**。只有读源码能发现。
 *
 * ## 分档
 *
 * | 档 | 含义 |
 * |---|---|
 * | `HIGH` | 从 uni 组件事件的 `target` 上取 `value` —— 几乎一定是这个 bug |
 * | `INFO` | 同一个函数里也读了 `detail` —— 像是合法的「先 detail，读不到才兜底」 |
 * | `SKIP` | 附近有原生 DOM 信号（`HTMLInputElement` / `.files` 等）—— 可能是真 DOM |
 * | `PARSE` | 这个 `<script>` 块没干净解析 —— **它报出的 0 命中不可信** |
 *
 * ## 三条刻意的设计（都是被真实数据逼出来的）
 *
 * 1. **不分辨「target 后面有没有紧跟 value」**，而是跨一层局部变量追。
 *    本工具的前身要求两者写在同一行，于是 `const d = e.target;` 换行再 `d.value`
 *    就穿过去了 —— 那正是它守了半年却被一次改写打掉的地方。
 * 2. **只在 uni-app 作用域内报**（祖先目录里有 `pages.json`）。很多仓是
 *    「网页后台 + uni-app 前端」并存，而在**网页 Vue 里 `event.target.value` 完全正确**。
 *    不分作用域，误报率立刻上天（实测：一个仓 6 条全是网页 Vue 代码）。
 * 3. **认不出的形状一律不报。** 这是给别人用的工具：
 *    **误报的代价是被关掉，漏报的代价只是少帮一次。**
 *
 * ## 已知守不住的（写清楚，别照错的判覆盖面）
 *
 * - 跨函数传递：`f(e.target)` 然后在 `f` 里读 `.value`。
 * - 把 target 存进对象/数组再取出来。
 * - 把 `detail` 读成别的名字再用 —— 那类改写本规则看不见。
 */

/** 只跳**构建产物**目录。名字太通用的一律不跳 —— 跳过只省时间，跳错就是错。 */
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'unpackage', '.git', '.nuxt', '.output',
  'coverage', '.idea', '.vscode',
]);

/** 原生 DOM 的信号 —— 这些场景下 `target.value` 是对的。 */
const NATIVE_HINTS =
  /HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement|\.files\b|FileList|document\./;

/** 模板里「从 `$event` 上读 target，并且取了 value」。 */
const TPL_RE = /\$event[\s\S]{0,60}?target[\s\S]{0,60}?value/;

/** 取 `<template>` 块；HTML 注释抹成等长空格（保持行号与偏移）。 */
export function templateBlock(src) {
  const open = src.indexOf('<template>');
  if (open < 0) return null;
  const close = src.lastIndexOf('</template>');
  if (close <= open) return null;
  const body = src
    .slice(open, close)
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  return { body, offset: open };
}

/** 所有 `<script>` 块，各自带在文件中的起始偏移（行号要能还原到文件）。 */
export function scriptBlocks(src) {
  const out = [];
  const re = /<script[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    out.push({ body: m[1], offset: m.index + m[0].indexOf(m[1]) });
  }
  return out;
}

/** 抹掉 JS 注释，保持偏移量。 */
export function blankJsComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

const lineOf = (text, pos) => text.slice(0, pos).split('\n').length;

function walkAst(node, visit) {
  visit(node);
  node.forEachChild((c) => walkAst(c, visit));
}

/** `<expr>.target` —— 属性名恰好是 `target` 的那次访问。`currentTarget` 不匹配。 */
function isTargetAccess(node) {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === 'target'
  );
}

function readsValue(node) {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === 'value'
  );
}

/** 剥掉 `as T` / `(x)` / `x!` 这些包装，拿到真正的被访问对象。 */
function unwrap(node) {
  let n = node;
  while (
    ts.isParenthesizedExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isNonNullExpression(n)
  ) {
    n = n.expression;
  }
  return n;
}

/** 包住这个节点的最内层函数的源文本。 */
function enclosingFunctionText(node, sf) {
  for (let cur = node; cur; cur = cur.parent) {
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur) ||
      ts.isMethodDeclaration(cur)
    ) {
      return sf.text.slice(cur.pos, cur.end);
    }
  }
  return sf.text;
}

/**
 * 扫一个 `<script>` 块。
 *
 * @returns `{ hits, diagCount }` —— `diagCount` 是语法诊断数。
 *   🔴 **`ts.createSourceFile()` 遇到语法问题不抛错**，它造一棵带错误节点的树继续跑。
 *   所以「没抛异常」证明不了「解析对了」：被解析坏的文件会**静默返回 0 命中**，
 *   而 0 命中正是本工具最常见的输出 ⇒ 分不清「写对了」和「根本没看懂」。
 */
export function scanScript(body) {
  const sf = ts.createSourceFile(
    'x.ts', body, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
  );
  const diagCount = (sf.parseDiagnostics || []).length;
  const hits = [];

  // ① 先找出「绑定自 .target」的标识符
  const derived = new Set();
  walkAst(sf, (n) => {
    if (!ts.isVariableDeclaration(n) || !n.initializer) return;
    const init = unwrap(n.initializer);
    if (isTargetAccess(init) && ts.isIdentifier(n.name)) {
      derived.add(n.name.text);
      return;
    }
    // const { target } = e   /   const { target: X } = e
    if (ts.isObjectBindingPattern(n.name)) {
      for (const el of n.name.elements) {
        const prop = el.propertyName ?? el.name;
        if (ts.isIdentifier(prop) && prop.text === 'target' && ts.isIdentifier(el.name)) {
          derived.add(el.name.text);
        }
      }
    }
  });

  // ② 再找「从它们（或直接从 .target）读 value」
  walkAst(sf, (n) => {
    if (!readsValue(n)) return;
    const base = unwrap(n.expression);

    let why = null;
    if (isTargetAccess(base)) {
      why = '直接从事件的 target 上读 value';
    } else if (ts.isIdentifier(base) && derived.has(base.text)) {
      why = `局部变量 \`${base.text}\` 绑定自 .target，再从它读 value`;
    }
    if (!why) return;

    // 🔴 **先剥注释再判**。`node.pos` 含前导 trivia，所以函数上面那行注释也在里面；
    //    而 handler 上面写一句「值在 detail.value」是极常见的写法 ——
    //    不剥注释的话，**写一句注释就能让规则对这个 bug 闭嘴**（夹具当场逮到过）。
    const fnText = blankJsComments(enclosingFunctionText(n, sf));
    const native = NATIVE_HINTS.test(fnText);
    // 「先 detail、读不到才兜底读 target」是**正确写法**，不该报。
    // 判据是「同一个函数里也读了 detail」——不是「往上三行内」：
    // 三行窗口会被 formatter 一换行就漂掉，函数边界不会。
    const hasDetailFallback = /\bdetail\b/.test(fnText);
    hits.push({
      pos: n.getStart(sf),
      level: native ? 'SKIP' : hasDetailFallback ? 'INFO' : 'HIGH',
      why: native
        ? `${why}（但所在函数有原生 DOM 信号，可能确实是真 DOM）`
        : hasDetailFallback
          ? `${why}，但同一个函数里也读了 detail —— 像是合法的「先 detail 后兜底」`
          : why,
    });
  });

  return { hits, diagCount };
}

/**
 * 这个 `.vue` 是不是 **uni-app** 的代码？
 *
 * 判据是祖先目录里有 `pages.json` —— uni-app 的**必需**配置（路由/分包/窗口都在里面），
 * 网页 Vue 项目没有。
 *
 * 🔴 不做这一步，误报率立刻上天：实测某个仓报了 6 条，全在
 * `admin/src/components/MDinput`、`dashboard/admin/components/TodoList` 下 ——
 * 那是 vue-element-admin 的**网页后台**，而在网页 Vue 里 `event.target.value` 完全正确。
 */
const SCOPE_MARKERS = [
  // 经典写法：uni-app 的必需配置
  'pages.json',
  // 🔴 现代模板（unibest / uni-helper 那一系）用 `@uni-helper/vite-plugin-uni-pages`
  //    **自动生成** pages.json，并把它写进 .gitignore ⇒ 仓里根本没有 pages.json。
  //    只认 pages.json 的话，这类项目会被整个排除、报一个看不出来的 0。
  //    实测：一个 2200+★ 的模板就是这样被我漏掉的。
  'pages.config.ts', 'pages.config.js', 'pages.config.mjs', 'pages.config.cjs',
];

export function inUniAppScope(fileAbs, root) {
  let dir = path.dirname(path.resolve(fileAbs));
  const stop = path.resolve(root);
  for (;;) {
    if (SCOPE_MARKERS.some((m) => fs.existsSync(path.join(dir, m)))) return true;
    if (dir === stop) return false;
    const up = path.dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
}

function walkDir(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      walkDir(path.join(dir, e.name), out);
    } else if (e.name.endsWith('.vue')) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

/** 扫一个 `.vue` 的文本。`rel` 只用于回报，不影响判定。 */
export function scanFile(rel, text) {
  const findings = [];

  const tpl = templateBlock(text);
  if (tpl) {
    tpl.body.split('\n').forEach((line, i) => {
      if (!TPL_RE.test(line)) return;
      findings.push({
        rule: 'template-event-target-value',
        level: 'HIGH',
        file: rel,
        line: lineOf(text, tpl.offset) + i,
        text: line.trim().slice(0, 130),
        why: '模板里从 $event.target 取 value —— uni 组件事件的 target 没有 value',
      });
    });
  }

  for (const blk of scriptBlocks(text)) {
    const { hits, diagCount } = scanScript(blk.body);
    if (diagCount > 0) {
      findings.push({
        rule: 'parse-unclean',
        level: 'PARSE',
        file: rel,
        line: lineOf(text, blk.offset),
        text: `${diagCount} 条语法诊断`,
        why: '这个 <script> 块没干净解析 —— 它报出的 0 命中不可信',
      });
    }
    for (const h of hits) {
      const fileLine = lineOf(text, blk.offset + h.pos);
      findings.push({
        rule: 'script-target-value',
        level: h.level,
        file: rel,
        line: fileLine,
        text: (text.split('\n')[fileLine - 1] ?? '').trim().slice(0, 130),
        why: h.why,
      });
    }
  }
  return findings;
}

/** 扫一个目录。返回 `{ fileCount, outOfScope, findings }`。 */
export function scanDir(root) {
  const all = walkDir(root);
  const files = all.filter((f) => inUniAppScope(f, root));
  const findings = [];
  for (const abs of files) {
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    try {
      findings.push(...scanFile(rel, text));
    } catch (err) {
      findings.push({
        rule: 'read-error',
        level: 'ERR',
        file: rel,
        line: 0,
        text: String(err && err.message).slice(0, 120),
        why: '这个文件没能扫完',
      });
    }
  }
  return { fileCount: files.length, outOfScope: all.length - files.length, findings };
}

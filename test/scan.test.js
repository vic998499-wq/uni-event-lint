import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanDir, scanScript, blankJsComments } from '../src/scan.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = (name) => path.join(HERE, 'fixtures', name);

const high = (r) => r.findings.filter((f) => f.level === 'HIGH');
const filesWithHigh = (r) => new Set(high(r).map((f) => f.file));

describe('阳性对照：该报的都报了，而且点得到名', () => {
  const bad = scanDir(FIX('bad'));

  // 🔴 **先证「真的扫到东西了」**。少了这条，下面每一条断言都可能是在空集合上恒真 ——
  // 本工具自己就撞过一次：跳过目录列表里的 `static` 把一整个仓吃掉，报了个 `.vue 0`。
  test('自检：真的扫到 .vue 了，不是在空集合上断言', () => {
    assert.ok(bad.fileCount >= 4, `只扫到 ${bad.fileCount} 个文件`);
    assert.equal(bad.outOfScope, 0);
  });

  test('bad/ 里每一个文件都必须至少报一条 HIGH', () => {
    const hit = filesWithHigh(bad);
    const missed = ['template-inline.vue', 'script-direct.vue',
      'script-destructured.vue', 'script-binding.vue'].filter((f) => !hit.has(f));
    assert.deepEqual(missed, [], `这些文件没报出来: ${missed.join(', ')}`);
  });

  test('模板内联那种（$event.target.value）报得出来', () => {
    const f = high(bad).find((x) => x.file === 'template-inline.vue');
    assert.ok(f, '没报');
    assert.equal(f.rule, 'template-event-target-value');
    assert.ok(f.line > 0 && f.text.includes('$event'), `行号/原文不对: ${f.line} ${f.text}`);
  });

  test('🔴 回归：局部变量拆两次访问也报得出来（前身正是栽在这里）', () => {
    const f = high(bad).find((x) => x.file === 'script-destructured.vue');
    assert.ok(f, '没报 —— 规则又退回「target 和 value 必须同行」了');
    assert.match(f.why, /局部变量/);
  });

  test('解构绑定 const { target } = e 也报得出来', () => {
    assert.ok(high(bad).some((x) => x.file === 'script-binding.vue'));
  });

  test('报出来的行号能对回文件里那一行原文', () => {
    for (const f of high(bad)) {
      assert.ok(f.line >= 1, `${f.file} 行号是 ${f.line}`);
      assert.ok(f.text.length > 0, `${f.file}:${f.line} 没有原文`);
    }
  });
});

describe('阴性对照：不该报的一条都没报', () => {
  const ok = scanDir(FIX('ok'));

  test('自检：ok/ 真的扫到文件了', () => {
    assert.ok(ok.fileCount >= 3, `只扫到 ${ok.fileCount} 个`);
  });

  test('🔴 ok/ 里 HIGH 必须是 0', () => {
    const names = high(ok).map((f) => `${f.file}:${f.line} ${f.text}`);
    assert.deepEqual(names, [], `误报了: ${names.join(' | ')}`);
  });

  test('「先 detail 后兜底 target」被判成 INFO 而不是 HIGH', () => {
    const f = ok.findings.find((x) => x.file === 'correct-and-fallback.vue' && x.level === 'INFO');
    assert.ok(f, '这种合法兜底应该被认出来并降档');
  });

  test('原生 DOM（#ifdef H5 的 input.value）被判成 SKIP', () => {
    const f = ok.findings.find(
      (x) => x.file === 'native-dom-and-current-target.vue' && x.level === 'SKIP',
    );
    assert.ok(f, '原生 DOM 那处应该降档为 SKIP');
  });

  test('解析必须是干净的（不干净的话上面那些 0 都不算数）', () => {
    const dirty = ok.findings.filter((f) => f.level === 'PARSE');
    assert.deepEqual(dirty.map((f) => f.file), []);
  });
});

describe('作用域：网页 Vue 不归本工具管', () => {
  const oos = scanDir(FIX('out-of-scope'));

  test('🔴 没有 pages.json 的目录：一个文件都不扫，一条都不报', () => {
    assert.equal(oos.fileCount, 0, '不该扫它');
    assert.equal(oos.outOfScope, 1, '应该如实报「有 1 个 .vue 被排除」');
    assert.equal(high(oos).length, 0);
  });

  test('outOfScope 这个数必须报出来 —— 否则 0 命中说不清是哪一种 0', () => {
    assert.ok(Object.hasOwn(oos, 'outOfScope'));
  });
});

describe('规则细节', () => {
  test('currentTarget 不匹配（大写 T）', () => {
    const { hits } = scanScript('function f(e){ return e.currentTarget.value }');
    assert.equal(hits.length, 0);
  });

  test('注释里写了 e.target.value 不算', () => {
    const src = '// 以前写的是 e.target.value\nconst a = 1;';
    assert.equal(blankJsComments(src).includes('target.value'), false);
  });

  test('🔴 解析不干净必须报出来，不能静默返回 0', () => {
    // `ts.createSourceFile` 语法错**不抛异常** —— 它造一棵带错误节点的树继续跑。
    // 没有这条信号，被解析坏的文件会给出一个看不出来的假 0。
    const { diagCount } = scanScript('function f(e { return e.target.value }');
    assert.ok(diagCount > 0, '语法明显不合法，却报了 0 条诊断');
  });

  test('语法合法的代码解析诊断为 0（阴性对照）', () => {
    const { diagCount } = scanScript('function f(e){ return e.detail.value }');
    assert.equal(diagCount, 0);
  });
});

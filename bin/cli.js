#!/usr/bin/env node
import process from 'node:process';
import { scanDir } from '../src/scan.js';

const HELP = `
uni-event-lint —— 找出 uni-app 里「从事件的 target 取 value」这类**静默失效**的写法

  用法:  uni-event-lint [目录]  [选项]

  选项:
    --json          输出 JSON（给 CI / 别的工具用）
    --quiet         只打 HIGH，不打 INFO / SKIP
    --exit-zero     即使有 HIGH 也返回 0（想先看看、暂不卡 CI 时用）
    -h, --help      看这个

  退出码:
    0   没有 HIGH
    1   有 HIGH（除非带了 --exit-zero）
    2   用法错误

  为什么需要它: uni 的 <input>/<picker>/<switch> 两端都是**组件**，事件里的
  target 只有 { id, dataset, offsetTop, offsetLeft }，**没有 value** —— 值在
  detail.value。写错了页面**一个错都不报**，而且**单元测试也照样绿**
  （jsdom 里 <input> 是原生元素，target.value 真的有值）。
`;

const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  console.log(HELP.trim());
  process.exit(0);
}

const flags = new Set(argv.filter((a) => a.startsWith('-')));
const positional = argv.filter((a) => !a.startsWith('-'));
if (positional.length > 1) {
  console.error('只能给一个目录。看 --help。');
  process.exit(2);
}
const root = positional[0] ?? '.';

let result;
try {
  result = scanDir(root);
} catch (err) {
  console.error(`扫描失败: ${err && err.message}`);
  process.exit(2);
}

const { fileCount, outOfScope, findings } = result;
const by = (lv) => findings.filter((f) => f.level === lv);
const high = by('HIGH');

if (flags.has('--json')) {
  console.log(JSON.stringify({ root, fileCount, outOfScope, findings }, null, 2));
} else {
  // 🔴 这几个数必须一起打出来，否则「0 命中」说不清是哪一种 0：
  //    扫了 0 个文件？全被判成不在 uni-app 作用域？还是真的写对了？
  console.log(`uni-event-lint  扫描 ${root}`);
  console.log(
    `  .vue ${fileCount} 个` +
      (outOfScope ? `（另有 ${outOfScope} 个不在 uni-app 作用域，已排除）` : '') +
      ` | HIGH ${high.length} · INFO ${by('INFO').length} · SKIP ${by('SKIP').length}` +
      (by('PARSE').length ? ` · ⚠️ 解析不干净 ${by('PARSE').length}` : '') +
      (by('ERR').length ? ` · 读失败 ${by('ERR').length}` : ''),
  );

  if (fileCount === 0) {
    console.log(
      '\n  ⚠️ 一个文件都没扫到。',
      outOfScope
        ? `找到了 ${outOfScope} 个 .vue，但它们的祖先目录里没有 pages.json ——\n     ` +
            '本工具只在 uni-app 作用域内报（网页 Vue 里 target.value 是对的）。\n     ' +
            '如果你的 uni-app 源码确实在别处，把那个目录直接传给它。'
        : '这个目录下没有 .vue 文件。',
    );
  }

  for (const f of high) {
    console.log(`\n  🔴 ${f.file}:${f.line}  [${f.rule}]`);
    console.log(`     ${f.text}`);
    console.log(`     ⇒ ${f.why}`);
  }

  if (!flags.has('--quiet')) {
    for (const f of [...by('INFO'), ...by('SKIP'), ...by('PARSE'), ...by('ERR')]) {
      const mark = { INFO: ' ·', SKIP: ' -', PARSE: ' ⚠', ERR: ' !' }[f.level];
      console.log(`  ${mark} ${f.file}:${f.line}  ${f.why}`);
    }
  }

  if (high.length) {
    console.log(
      `\n  修法：改读 \`e.detail.value\`。` +
        `\n  两端都要：H5 的 uni-h5 组件和小程序的原生组件，target 上都没有 value。`,
    );
  }
}

process.exit(high.length && !flags.has('--exit-zero') ? 1 : 0);

import { exec } from 'node:child_process';

const cwd = 'C:/Users/吴清';
const cmd = 'dir /s /b 固定资产.xlsx 2>nul';
const timeout = 30_000;

console.log(`[test] START cmd="${cmd}" cwd="${cwd}" timeout=${timeout}ms`);
console.log(`[test] Node version: ${process.version}`);

// ── Test 1: encoding='buffer' + GBK decode (same as production backend) ──
console.log('\n─── Test: encoding=buffer + GBK decode ───');
const t0 = Date.now();
const child = exec(cmd, { cwd, timeout, windowsHide: true, encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 },
  (err, stdout, stderr) => {
    const elapsed = Date.now() - t0;
    const dec = (buf) => {
      if (!buf || buf.length === 0) return '';
      if (typeof buf === 'string') return buf;
      try { return new TextDecoder('gbk').decode(buf); } catch { return buf.toString('utf-8'); }
    };
    const out = dec(stdout);
    const errStr = err && !stderr ? err.message : dec(stderr);
    console.log(`[test] END elapsed=${elapsed}ms ok=${!err} exit=${err?.code ?? 0} killed=${err?.killed ?? false} stdout=${out.length}B`);
    if (out) console.log(`[test] stdout:\n${out.slice(0, 500)}`);
    if (err) console.log(`[test] error: ${err.message}`);
    console.log('\nDone.');
  });

child.on('spawn', () => console.log('[test] spawned'));
child.on('error', (e) => console.log('[test] event error:', e.message));

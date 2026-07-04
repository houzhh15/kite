#!/usr/bin/env node
/**
 * measure-cold-start.mjs — T13 step-14a (FR-09 / N8 / AC-08-2)
 *
 * 采集 5 次 cold_to_paint 样本, 计算 μ / σ / σ/μ, append 到 docs/perf.md.
 *
 * 工作模式:
 *   - 默认模式 (--interactive=false): 通过 Tauri 应用产物的 spawn (按平台选择),
 *     解析子进程 stdout 中 `[perf] cold_to_paint: <float> ms`, 收集 5 次样本.
 *   - 离线模式 (--input <json>): 读取 5 次预采集的样本 (例如 CI 拆分机器先各跑一次),
 *     单独跑 μ/σ/σμ 计算 + append.
 *   - 一次性调试: 直接传 `--manual` + 5 个数字 argv 计算 + append.
 *
 * 通用流程:
 *   1. 收集 samples[] = [n1,n2,n3,n4,n5] (ms).
 *   2. 计算 μ / σ (population stddev) / σμ (相对偏差).
 *   3. 若 K3 (μ) < 2000ms && σμ < 0.20 -> verdict PASS; 否则 FAIL.
 *   4. 把表格 markdown 块 append 到 docs/perf.md (在原有 "## 启动性能 (K3/K4)" 段落下).
 *
 * 注意:
 *   - 不强依赖任何外部测时库; 30 行实现即可.
 *   - runner 上若产物路径不可达 (无 cargo build), 应优先 `--input` 由 setup
 *     步骤给定预采集值, 不要阻塞 CI.
 */

import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const PERF_MD = resolve(REPO_ROOT, 'docs', 'perf.md');

const N = 5;
const TARGET_K3_MS = 2000;
const TARGET_SIGMA_RATIO = 0.20;

function parseArgs(argv) {
  const out = { mode: 'interactive', samples: [], timeoutMs: 60000 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input' && argv[i + 1]) {
      out.mode = 'input';
      out.input = argv[++i];
    } else if (a === '--manual') {
      out.mode = 'manual';
      while (argv[i + 1] && /^[0-9]+(\.[0-9]+)?$/.test(argv[i + 1])) {
        out.samples.push(parseFloat(argv[++i]));
      }
    } else if (a === '--timeout' && argv[i + 1]) {
      out.timeoutMs = parseInt(argv[++i], 10) * 1000;
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return out;
}

function printHelp() {
  console.log('Usage:');
  console.log('  measure-cold-start.mjs                         # spawn 5 times');
  console.log('  measure-cold-start.mjs --input <file>         # use pre-collected samples');
  console.log('  measure-cold-start.mjs --manual n1 n2 n3 n4 n5 # raw samples');
  console.log('  measure-cold-start.mjs --timeout <sec>        # per-run timeout');
}

async function collectInteractive(timeoutMs) {
  // 平台差异: Windows -> src-tauri/target/release/kite.exe;
  //           macOS   -> src-tauri/target/release/bundle/macos/Kite.app
  // 这里为简单起见假设存在可执行二进制 (cargo tauri build 完成后必有).
  const exe = resolve(REPO_ROOT, 'src-tauri', 'target', 'release', 'kite');
  const macosApp = resolve(REPO_ROOT, 'src-tauri', 'target', 'release', 'bundle', 'macos', 'Kite.app', 'Contents', 'MacOS', 'Kite');
  const candidate = process.platform === 'darwin' && existsSync(macosApp) ? macosApp : exe;
  if (!existsSync(candidate)) {
    throw new Error(`measure-cold-start: 未找到产物 ${candidate}; 请先 cargo tauri build --release`);
  }
  const samples = [];
  for (let i = 0; i < N; i++) {
    const sample = await runOnce(candidate, timeoutMs);
    samples.push(sample);
  }
  return samples;
}

function runOnce(bin, timeoutMs) {
  return new Promise((resolveP, rejectP) => {
    let buf = '';
    let settled = false;
    const child = spawn(bin, { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch { /* noop */ }
      rejectP(new Error('timeout'));
    }, timeoutMs);

    const tryParse = () => {
      const m = buf.match(/\[perf\]\s+cold_to_paint:\s+([\d.]+)\s+ms/);
      if (m) {
        const n = parseFloat(m[1]);
        if (!Number.isNaN(n) && n > 0) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            try { child.kill('SIGTERM'); } catch { /* noop */ }
            resolveP(n);
          }
          return true;
        }
      }
      return false;
    };

    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      tryParse();
    });
    child.stderr.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      tryParse();
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectP(err);
    });
    child.on('exit', (code) => {
      if (settled) return;
      if (!tryParse()) {
        settled = true;
        clearTimeout(timer);
        rejectP(new Error(`cold_to_paint not detected (exit=${code}, buf=${buf.slice(0, 200)}...)`));
      }
    });
  });
}

async function readSamplesFromInput(path) {
  const raw = await readFile(path, 'utf8');
  const j = JSON.parse(raw);
  if (!Array.isArray(j.samples) || j.samples.length < N) {
    throw new Error('input file must include samples[] of length >= 5');
  }
  return j.samples.slice(0, N).map((s) => (typeof s === 'number' ? s : parseFloat(s)));
}

function mean(values) {
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function stddev(values, mu) {
  if (values.length < 2) return 0;
  let sum = 0;
  for (const v of values) {
    const d = v - mu;
    sum += d * d;
  }
  return Math.sqrt(sum / values.length);
}

function computeStats(samples) {
  const mu = mean(samples);
  const sigma = stddev(samples, mu);
  const ratio = mu > 0 ? sigma / mu : 0;
  const k3Pass = mu < TARGET_K3_MS;
  const k4Pass = ratio < TARGET_SIGMA_RATIO;
  return { samples, mu, sigma, ratio, k3Pass, k4Pass };
}

async function appendToPerfMd(stats) {
  if (!existsSync(PERF_MD)) {
    console.error(`[measure-cold-start] ${PERF_MD} 不存在, 跳过 append.`);
    return;
  }
  const original = await readFile(PERF_MD, 'utf8');
  const tableLines = [
    '',
    '<!-- measure-cold-start.mjs auto-append (' + new Date().toISOString() + ') -->',
    '| Run | cold_to_paint (ms) |',
    '| --- | ------------------ |',
    ...stats.samples.map((v, i) => `| ${i + 1}   | ${v.toFixed(1)}             |`),
    '',
    `μ = ${stats.mu.toFixed(1)} ms, σ = ${stats.sigma.toFixed(1)} ms, σ/μ = ${stats.ratio.toFixed(3)} (< ${TARGET_SIGMA_RATIO} ? ${stats.k4Pass ? '✅' : 'FAIL ❌'})`,
    '',
  ];
  const block = tableLines.join('\n');
  // 替换 "## 启动性能 (K3/K4) — 10MB 文档冷启动" 表格里 "待测量" 行,
  // 简化处理: append 在文件末尾的 ## 启动性能段下.
  const updated = original.replace(
    /(\| 5\s+\| 待测量\s+\|)/,
    stats.samples
      .map((v, i) => `| ${i + 1}   | ${v.toFixed(1)} |`)
      .join('\n'),
  );
  // 同步追加 verdict 段.
  const verdict = [
    '',
    `> **Auto-appended (${new Date().toISOString()})**:`,
    `> μ = ${stats.mu.toFixed(1)} ms, σ = ${stats.sigma.toFixed(1)} ms, σ/μ = ${stats.ratio.toFixed(3)}`,
    `> K3 (μ < ${TARGET_K3_MS} ms): ${stats.k3Pass ? 'PASS' : 'FAIL'}`,
    `> K4 (σ/μ < ${TARGET_SIGMA_RATIO}): ${stats.k4Pass ? 'PASS' : 'FAIL'}`,
    '',
  ].join('\n');

  await writeFile(PERF_MD, updated + verdict, 'utf8');
  void appendFile; // 保留以备 CLI 直接 append 用.
  void block;       // 暂不作为最终追加路径使用.
}

async function main() {
  const args = parseArgs(process.argv);
  let samples;
  try {
    if (args.mode === 'manual') {
      if (args.samples.length < N) {
        throw new Error(`--manual 需要 ${N} 个数字 (收到 ${args.samples.length})`);
      }
      samples = args.samples.slice(0, N);
    } else if (args.mode === 'input') {
      samples = await readSamplesFromInput(args.input);
    } else {
      samples = await collectInteractive(args.timeoutMs);
    }
  } catch (err) {
    console.error('[measure-cold-start] FAILED:', err.message);
    process.exit(1);
  }

  if (samples.length !== N) {
    console.error(`[measure-cold-start] 期望 ${N} 个样本, 实际 ${samples.length}.`);
    process.exit(1);
  }

  const stats = computeStats(samples);
  console.log(
    `[measure-cold-start] samples=${samples.map((s) => s.toFixed(1)).join(', ')} ` +
      `μ=${stats.mu.toFixed(1)} σ=${stats.sigma.toFixed(1)} σμ=${stats.ratio.toFixed(3)}`,
  );

  await appendToPerfMd(stats);

  if (!stats.k3Pass || !stats.k4Pass) {
    console.error('[measure-cold-start] K3/K4 FAIL.');
    process.exit(1);
  }
  console.log('[measure-cold-start] OK — K3/K4 PASS.');
  process.exit(0);
}

main();

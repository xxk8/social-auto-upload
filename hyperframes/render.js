/**
 * Hyperframes 渲染桥接脚本
 *
 * 从 stdin 读取 JSON payload（包含 project + episodes），生成 Hyperframes
 * composition HTML，然后调用 `npx hyperframes render` 输出 MP4。
 *
 * 用法：
 *   echo '{"project":{...},"episodes":[...]}' | node render.js --out /path/render.mp4
 *
 * 退出码：0 = 成功，1 = 渲染失败
 */

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

// ── 参数解析 ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
let outPath = null
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') {
    outPath = args[i + 1]
    i++
  }
}

if (!outPath) {
  process.stderr.write('ERROR: --out <path> is required\n')
  process.exit(1)
}

// ── 读取 payload ────────────────────────────────────────────────────────

let payload
try {
  const raw = readFileSync(0, 'utf-8')
  payload = JSON.parse(raw)
} catch (e) {
  process.stderr.write(`ERROR: failed to parse stdin JSON: ${e.message}\n`)
  process.exit(1)
}

const { project = {}, episodes = [] } = payload

// ── 构建场景列表 ────────────────────────────────────────────────────────

const WIDTH = 1080
const HEIGHT = 1920
const CHARS_PER_SEC = 14
const MIN_SCENE_SEC = 3
const MAX_SCENE_SEC = 8

function sceneDuration(body) {
  const secs = body.length / CHARS_PER_SEC
  return Math.min(MAX_SCENE_SEC, Math.max(MIN_SCENE_SEC, secs))
}

function buildScenes() {
  const scenes = []
  const push = (title, body) => {
    if (!body || !body.trim()) return
    scenes.push({ title, body })
  }

  if (episodes.length) {
    for (const ep of episodes) {
      const scenesJson = ep.scenes || []
      const dialogues = ep.dialogues || []
      if (scenesJson.length || dialogues.length) {
        const chunks = [...scenesJson.map(String), ...dialogues.map(String)]
        push(`第 ${ep.episode_no} 集 · ${ep.title || ''}`, chunks.join('\n'))
      } else if (ep.title) {
        push(`第 ${ep.episode_no} 集`, ep.title)
      }
    }
  }

  if (!scenes.length) {
    const synopsis = (project.synopsis || '').trim()
    if (synopsis) {
      for (const part of synopsis.split('\n')) {
        if (part.trim()) push(project.title || '梗概', part.trim())
      }
    }
  }

  if (!scenes.length) {
    scenes.push({ title: project.title || '未命名', body: '（暂无内容）' })
  }

  return scenes
}

const scenes = buildScenes()
const totalDuration = scenes.reduce((acc, s) => acc + sceneDuration(s.body), 0)

// ── 生成 composition HTML ───────────────────────────────────────────────

function escapeHtml(str) {
  return str
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#39;')
}

// 每屏卡片：title + body，逐屏切换 + fade
let cumulative = 0
const clipDivs = scenes
  .map((sc, i) => {
    const dur = sceneDuration(sc.body)
    const start = cumulative
    cumulative += dur
    const idx = i + 1
    return `
      <div id="clip-${i}" class="clip" data-start="${start.toFixed(2)}" data-duration="${dur.toFixed(2)}" data-track-index="1">
        <div class="meta">${idx} / ${scenes.length}</div>
        <h1 class="title">${escapeHtml(sc.title)}</h1>
        <div class="divider"></div>
        <p class="body">${escapeHtml(sc.body)}</p>
      </div>`
  })
  .join('\n')

// GSAP 动画：每屏 fade in + 轻微上移
const tlSetup = scenes
  .map((_, i) => {
    return `tl.from("#clip-${i}", { opacity: 0, y: 40, duration: 0.5 }, ${0});`
  })
  .join('\n')

const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${WIDTH}, height=${HEIGHT}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        margin: 0;
        width: ${WIDTH}px;
        height: ${HEIGHT}px;
        overflow: hidden;
        background: #12121A;
        font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
      }
      .clip {
        position: absolute;
        inset: 0;
        width: ${WIDTH}px;
        height: ${HEIGHT}px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 120px;
        background: linear-gradient(160deg, #1e1e2a 0%, #12121a 100%);
      }
      .clip::before {
        content: "";
        position: absolute;
        left: 0; top: 0; bottom: 0;
        width: 14px;
        background: #6366f1;
      }
      .meta {
        font-size: 34px;
        color: #9696a5;
        margin-bottom: 24px;
        font-variant-numeric: tabular-nums;
      }
      .title {
        font-size: 72px;
        font-weight: 700;
        color: #ebebf0;
        line-height: 1.25;
        margin-bottom: 40px;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .divider {
        width: 100%;
        height: 3px;
        background: #2e2e36;
        margin-bottom: 48px;
      }
      .body {
        font-size: 48px;
        color: #ebebf0;
        line-height: 1.6;
        white-space: pre-wrap;
        word-break: break-word;
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${totalDuration.toFixed(2)}"
      data-width="${WIDTH}"
      data-height="${HEIGHT}"
    >
      ${clipDivs}
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      ${tlSetup}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>`

// ── 写入临时目录并渲染 ──────────────────────────────────────────────────
// Hyperframes CLI 期望第一个位置参数是「项目目录」(包含 index.html)，
// 而非单独的 HTML 文件。所以这里写到 <workDir>/index.html。

const workDir = mkdtempSync(join(tmpdir(), 'hyperframes-'))
const compPath = join(workDir, 'index.html')
writeFileSync(compPath, html, 'utf-8')

try {
  execFileSync(
    'npx',
    ['hyperframes', 'render', workDir, '-o', outPath],
    { stdio: 'inherit', cwd: workDir, timeout: 300000 },
  )
  process.stdout.write(
    JSON.stringify({
      success: true,
      duration: Number(totalDuration.toFixed(2)),
      width: WIDTH,
      height: HEIGHT,
    }),
  )
} catch (e) {
  process.stderr.write(`ERROR: hyperframes render failed: ${e.message}\n`)
  process.exit(1)
}
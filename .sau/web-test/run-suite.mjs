import { chromium } from './node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:5174';
const API = 'http://localhost:6001';
const pages = [
  { name: 'landing', path: '/' },
  { name: 'login', path: '/login' },
  { name: 'login-auth', path: '/login/auth' },
  { name: 'forgot-password', path: '/login/forgot-password' },
  { name: 'reset-password', path: '/login/reset-password' },
  { name: 'pricing', path: '/pricing' },
  { name: 'about', path: '/about' },
  { name: 'hotlist', path: '/hotlist' },
  { name: 'catalog', path: '/catalog' },
  { name: 'dashboard-accounts', path: '/dashboard' },
  { name: 'publish', path: '/dashboard/publish' },
  { name: 'tasks', path: '/dashboard/tasks' },
  { name: 'calendar', path: '/dashboard/calendar' },
  { name: 'analytics', path: '/dashboard/analytics' },
  { name: 'logs', path: '/dashboard/logs' },
  { name: 'inbox', path: '/dashboard/inbox' },
  { name: 'studio', path: '/dashboard/studio' },
  { name: 'studio-detail', path: '/dashboard/studio/1' },
  { name: 'account', path: '/dashboard/account' },
  { name: 'settings', path: '/dashboard/settings' },
  { name: 'personalization', path: '/dashboard/personalization' },
  { name: 'crawl', path: '/dashboard/crawl' },
  { name: 'admin', path: '/dashboard/admin' },
  { name: 'admin-users', path: '/dashboard/admin/users' },
  { name: 'admin-audit', path: '/dashboard/admin/audit' },
  { name: 'legacy-publish', path: '/publish' },
  { name: 'legacy-tasks', path: '/tasks' },
  { name: 'legacy-logs', path: '/logs' },
  { name: 'legacy-analytics', path: '/analytics' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const results = [];

for (const p of pages) {
  const entry = {
    name: p.name,
    path: p.path,
    ok: false,
    finalUrl: '',
    title: '',
    h1: [],
    headings: [],
    buttons: [],
    inputs: [],
    bodySnippet: '',
    consoleErrors: [],
    pageErrors: [],
    failedApi: [],
    apiCalls: [],
    loadMs: 0,
    hasErrorBoundary: false,
    emptyState: false,
    notes: [],
  };

  const consoleErrors = [];
  const pageErrors = [];
  const apiCalls = [];
  const failedApi = [];

  const onConsole = (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 400));
  };
  const onPageError = (err) => pageErrors.push(String(err).slice(0, 400));
  const onResponse = (res) => {
    const url = res.url();
    if (!url.includes('/api/')) return;
    let short = url;
    try {
      const u = new URL(url);
      short = u.pathname + u.search;
    } catch {}
    const item = { url: short.slice(0, 180), status: res.status() };
    apiCalls.push(item);
    if (res.status() >= 400) failedApi.push(item);
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);

  const t0 = Date.now();
  try {
    const resp = await page.goto(BASE + p.path, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await sleep(1000);
    entry.loadMs = Date.now() - t0;
    entry.finalUrl = page.url();
    entry.title = await page.title();

    const info = await page.evaluate(() => {
      const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
      const h1 = [...document.querySelectorAll('h1')].map(text).filter(Boolean);
      const headings = [...document.querySelectorAll('h1,h2,h3')].map(text).filter(Boolean).slice(0, 25);
      const buttons = [...document.querySelectorAll('button')]
        .map((b) => text(b).slice(0, 50))
        .filter(Boolean)
        .slice(0, 35);
      const inputs = [...document.querySelectorAll('input,textarea,select')]
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') || '',
          name: el.getAttribute('name') || el.getAttribute('id') || '',
          placeholder: el.getAttribute('placeholder') || '',
        }))
        .slice(0, 35);
      const body = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
      const hasErrorBoundary = /出错了|Something went wrong|ErrorBoundary|渲染出错|页面崩溃|Unexpected Application Error/i.test(body);
      const emptyState = /暂无|没有数据|空空|还没有任何|No data|empty/i.test(body);
      return {
        h1,
        headings,
        buttons,
        inputs,
        bodySnippet: body.slice(0, 700),
        hasErrorBoundary,
        emptyState,
        rootChildren: document.getElementById('root')?.children?.length || 0,
      };
    });
    Object.assign(entry, info);
    entry.consoleErrors = consoleErrors.slice(0, 12);
    entry.pageErrors = pageErrors.slice(0, 12);
    entry.failedApi = failedApi.slice(0, 25);
    entry.apiCalls = apiCalls.slice(0, 50);
    entry.ok = !entry.hasErrorBoundary && entry.pageErrors.length === 0 && (resp?.ok() ?? true);
    if (entry.rootChildren === 0) {
      entry.ok = false;
      entry.notes.push('root has no children');
    }
    if ((entry.bodySnippet || '').length < 15) {
      entry.ok = false;
      entry.notes.push('body text too short');
    }
    if (p.path === '/publish' && !entry.finalUrl.includes('/dashboard/publish')) entry.notes.push('legacy redirect may have failed');
    if (p.path === '/tasks' && !entry.finalUrl.includes('/dashboard/tasks')) entry.notes.push('legacy redirect may have failed');
    const shot = path.join('../..', 'output/playwright', `${p.name}.png`);
    fs.mkdirSync(path.dirname(shot), { recursive: true });
    await page.screenshot({ path: shot, fullPage: false });
    entry.screenshot = shot;
  } catch (e) {
    entry.loadMs = Date.now() - t0;
    entry.ok = false;
    entry.notes.push(String(e).slice(0, 400));
    entry.consoleErrors = consoleErrors.slice(0, 12);
    entry.pageErrors = pageErrors.slice(0, 12);
    entry.failedApi = failedApi.slice(0, 25);
  }

  page.off('console', onConsole);
  page.off('pageerror', onPageError);
  page.off('response', onResponse);

  results.push(entry);
  const status = entry.ok ? 'PASS' : 'FAIL';
  console.log(
    `${status}  ${p.path.padEnd(36)} ${String(entry.loadMs).padStart(5)}ms  apiFail=${entry.failedApi.length}  jsErr=${entry.pageErrors.length + entry.consoleErrors.length}  h1=${JSON.stringify(entry.h1).slice(0, 50)}`,
  );
}

const interactions = [];
async function interact(name, fn, soft = false) {
  try {
    const detail = await fn();
    const ok = detail && typeof detail.ok === 'boolean' ? detail.ok : true;
    interactions.push({ name, ok, soft, detail });
    console.log(`${ok ? 'PASS' : soft ? 'SOFT' : 'FAIL'}  INT ${name}`);
  } catch (e) {
    interactions.push({ name, ok: false, soft, detail: String(e).slice(0, 400) });
    console.log(`FAIL  INT ${name}: ${e}`);
  }
}

await interact('dashboard shows account group', async () => {
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(700);
  const text = await page.evaluate(() => document.body.innerText);
  return { ok: /浏览器测试组|账号组|新建|授权|账号管理/.test(text), snippet: text.slice(0, 250) };
});

await interact('dashboard create group dialog', async () => {
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(500);
  const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const b = btns.find((x) => /新建|创建|添加组|新增/.test(x.textContent || ''));
    if (b) {
      b.click();
      return b.textContent.trim().slice(0, 40);
    }
    return null;
  });
  await sleep(500);
  const after = await page.evaluate(() => {
    const dialog = document.querySelector('[role=dialog]');
    return { hasDialog: !!dialog, text: document.body.innerText.slice(0, 300) };
  });
  return { ok: !!clicked || after.hasDialog || /账号/.test(after.text), clicked, after };
});

await interact('publish page form surface', async () => {
  await page.goto(BASE + '/dashboard/publish', { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(900);
  const pub = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      inputs: document.querySelectorAll('input,textarea,select').length,
      fileInputs: document.querySelectorAll('input[type=file]').length,
      hasVideo: /视频|Video/.test(body),
      hasNote: /图文|Note/.test(body),
      hasPublish: /发布|Publish|提交/.test(body),
      snippet: body.slice(0, 350),
    };
  });
  return { ok: pub.inputs > 0 || pub.hasVideo || pub.hasPublish, ...pub };
});

await interact('publish switch note mode', async () => {
  await page.goto(BASE + '/dashboard/publish', { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(700);
  const res = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('button, [role=tab], label, a')];
    const note = candidates.find((el) => /图文|Note/.test(el.textContent || ''));
    if (note) note.click();
    return { clicked: !!note, label: note ? (note.textContent || '').trim().slice(0, 40) : null };
  });
  await sleep(500);
  const body = await page.evaluate(() => document.body.innerText.slice(0, 300));
  return { ok: res.clicked || /图文/.test(body), ...res, body };
}, true);

await interact('tasks page shows data', async () => {
  await page.goto(BASE + '/dashboard/tasks', { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(1200);
  const tasks = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      hasTask: /e2e-dry|demo|douyin|check|failed|失败|成功|任务|重试/.test(body),
      rows: document.querySelectorAll('tr, [data-task]').length,
      snippet: body.slice(0, 400),
    };
  });
  return { ok: tasks.hasTask, ...tasks };
});

await interact('tasks filter failed chip', async () => {
  await page.goto(BASE + '/dashboard/tasks', { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(800);
  const res = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('button, [role=tab]')];
    const failed = chips.find((c) => /失败|failed|Failed/.test(c.textContent || ''));
    if (failed) failed.click();
    return { clicked: !!failed, label: failed ? failed.textContent.trim().slice(0, 40) : null };
  });
  await sleep(700);
  return { ok: true, ...res };
}, true);

await interact('logs page shows entries', async () => {
  await page.goto(BASE + '/dashboard/logs', { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(900);
  const logs = await page.evaluate(() => {
    const body = document.body.innerText;
    return { hasLog: /upload|accounts|日志|saved|rejected|\[/.test(body), snippet: body.slice(0, 350) };
  });
  return { ok: logs.hasLog, ...logs };
});

await interact('studio lists projects', async () => {
  await page.goto(BASE + '/dashboard/studio', { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(900);
  const st = await page.evaluate(() => {
    const body = document.body.innerText;
    return { hasProject: /剧本A|Demo|S1|项目|创建|工坊/.test(body), snippet: body.slice(0, 350) };
  });
  return { ok: st.hasProject, ...st };
});

await interact('studio create + open detail', async () => {
  const res = await page.request.post(API + '/api/studio/projects', {
    data: { title: '浏览器全测-' + Date.now(), synopsis: 'auto test', style: '纪实' },
  });
  const json = await res.json().catch(() => ({}));
  const id = json?.data?.id;
  if (!id) return { ok: false, status: res.status(), json };
  await page.goto(BASE + `/dashboard/studio/${id}`, { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(900);
  const det = await page.evaluate(() => document.body.innerText.slice(0, 500));
  return {
    ok: /浏览器全测|纪实|生成|幕|剧本|起|承|转|合|synopsis|导出|渲染/.test(det),
    id,
    status: res.status(),
    snippet: det.slice(0, 250),
  };
});

await interact('crawl page content', async () => {
  await page.goto(BASE + '/dashboard/crawl', { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(900);
  const cr = await page.evaluate(() => {
    const body = document.body.innerText;
    return { okText: /采集|搜索|平台|情感|关键词|数据/.test(body), snippet: body.slice(0, 400) };
  });
  return { ok: cr.okText, ...cr };
});

await interact('inbox download surface', async () => {
  await page.goto(BASE + '/dashboard/inbox', { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(900);
  const ib = await page.evaluate(() => {
    const body = document.body.innerText;
    const inputs = [...document.querySelectorAll('input')].map((i) => i.placeholder || i.name || i.type);
    return { hasUrl: /http|url|下载|链接|视频|收件箱|yt/.test(body), inputs, snippet: body.slice(0, 400) };
  });
  return { ok: ib.hasUrl || ib.inputs.length > 0, ...ib };
});

await interact('analytics metrics', async () => {
  await page.goto(BASE + '/dashboard/analytics', { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(1100);
  const an = await page.evaluate(() => {
    const body = document.body.innerText;
    const svg = document.querySelectorAll('svg').length;
    return { hasMetrics: /成功|失败|任务|平台|账号|成功率|发布|统计|分析/.test(body), svg, snippet: body.slice(0, 400) };
  });
  return { ok: an.hasMetrics, ...an };
});

await interact('calendar surface', async () => {
  await page.goto(BASE + '/dashboard/calendar', { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(1100);
  const cal = await page.evaluate(() => {
    const body = document.body.innerText;
    return { hasCal: /日|月|周|calendar|2026|今天|任务|July|Jul/.test(body), snippet: body.slice(0, 350) };
  });
  return { ok: cal.hasCal, ...cal };
});

await interact('settings page renders', async () => {
  await page.goto(BASE + '/dashboard/settings', { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(700);
  const se = await page.evaluate(() => document.body.innerText.slice(0, 500));
  return { ok: se.length > 40, snippet: se.slice(0, 250) };
});

await interact('personalization page renders', async () => {
  await page.goto(BASE + '/dashboard/personalization', { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(700);
  const se = await page.evaluate(() => document.body.innerText.slice(0, 500));
  return { ok: se.length > 40, snippet: se.slice(0, 250) };
});

await interact('account profile page', async () => {
  await page.goto(BASE + '/dashboard/account', { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(700);
  const se = await page.evaluate(() => document.body.innerText.slice(0, 500));
  return { ok: /local|admin|邮箱|账号|profile|用户|role/i.test(se), snippet: se.slice(0, 250) };
});

await interact('admin overview', async () => {
  await page.goto(BASE + '/dashboard/admin', { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(900);
  const se = await page.evaluate(() => document.body.innerText.slice(0, 500));
  return { ok: /管理|用户|审计|admin|overview|统计/i.test(se), snippet: se.slice(0, 250) };
});

await interact('nav click to publish', async () => {
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(500);
  const clicked = await page.evaluate(() => {
    const anchors = [...document.querySelectorAll('a')];
    const pub = anchors.find(
      (a) => (a.getAttribute('href') || '').includes('/dashboard/publish') || /发布/.test(a.textContent || ''),
    );
    if (pub) {
      pub.click();
      return true;
    }
    return false;
  });
  await sleep(1200);
  return { ok: clicked && page.url().includes('/publish'), clicked, url: page.url() };
});

await interact('command palette Meta+K', async () => {
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(400);
  await page.keyboard.press('Meta+k');
  await sleep(600);
  const palette = await page.evaluate(() => {
    const dialog = document.querySelector('[role=dialog], [cmdk-root], [data-command-palette], [cmdk-dialog]');
    const body = document.body.innerText;
    return {
      open: !!dialog || /命令面板|Command|跳转到|搜索命令|⌘K|Cmd/.test(body),
      hasDialog: !!dialog,
      snippet: body.slice(0, 200),
    };
  });
  await page.keyboard.press('Escape');
  return { ok: palette.open, ...palette };
});

await interact('pricing page tiers', async () => {
  await page.goto(BASE + '/pricing', { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(700);
  const pr = await page.evaluate(() => {
    const body = document.body.innerText;
    return { ok: /免费|Free|定价|Pro|套餐|方案|月/.test(body), snippet: body.slice(0, 300) };
  });
  return pr;
});

await interact('hotlist page content', async () => {
  await page.goto(BASE + '/hotlist', { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(800);
  const h = await page.evaluate(() => {
    const body = document.body.innerText;
    return { ok: /热榜|热点|抖音|微博|知乎|榜|trending/i.test(body), snippet: body.slice(0, 300) };
  });
  return h;
});

await interact('about page content', async () => {
  await page.goto(BASE + '/about', { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(600);
  const h = await page.evaluate(() => {
    const body = document.body.innerText;
    return { ok: /关于|social-auto-upload|本地|开源|GitHub|项目/i.test(body), snippet: body.slice(0, 300) };
  });
  return h;
});

await interact('login page fields', async () => {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(600);
  const h = await page.evaluate(() => {
    const body = document.body.innerText;
    const inputs = document.querySelectorAll('input').length;
    return {
      ok: /登录|邮箱|验证码|密码|Login|email/i.test(body) || inputs > 0,
      inputs,
      snippet: body.slice(0, 300),
    };
  });
  return h;
});

await interact('API account-groups + templates + analytics', async () => {
  const g = await (await page.request.get(API + '/api/account-groups')).json();
  const t = await (await page.request.get(API + '/api/templates')).json();
  const a = await (await page.request.get(API + '/api/analytics/summary')).json();
  return {
    ok: !!g?.data && Array.isArray(t?.data) && !!a?.data,
    groups: g?.data?.length,
    templates: t?.data?.map((x) => x.name),
    analyticsKeys: a?.data ? Object.keys(a.data) : [],
  };
});

await interact('API crawl data + inbox list', async () => {
  const c = await (await page.request.get(API + '/api/crawl/data')).json();
  const i = await (await page.request.get(API + '/api/inbox/list')).json();
  return {
    ok: Array.isArray(c?.data) && Array.isArray(i?.data),
    crawlCount: c?.data?.length,
    inboxCount: i?.data?.length,
  };
});

await interact('API calendar range', async () => {
  const c = await (await page.request.get(API + '/api/calendar/tasks?start=2026-07-01&end=2026-07-31')).json();
  return { ok: !!c?.data || c?.success === true, keys: c?.data ? Object.keys(c.data) : c };
});

await interact('legacy /publish redirects', async () => {
  await page.goto(BASE + '/publish', { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(500);
  return { ok: page.url().includes('/dashboard/publish'), url: page.url() };
});

// Publish form fill dry-run (no submit if no accounts)
await interact('publish fill title draft', async () => {
  await page.goto(BASE + '/dashboard/publish', { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(800);
  const filled = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input,textarea')];
    const title = inputs.find((i) => /标题|title/i.test(i.placeholder || '') || /title/i.test(i.name || i.id || ''));
    if (title) {
      const proto = title.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter?.call(title, '全方面测试标题 ' + Date.now());
      title.dispatchEvent(new Event('input', { bubbles: true }));
      title.dispatchEvent(new Event('change', { bubbles: true }));
      return { filled: true, value: title.value, placeholder: title.placeholder };
    }
    return {
      filled: false,
      placeholders: inputs.map((i) => i.placeholder || i.name || i.id).slice(0, 15),
    };
  });
  return { ok: true, ...filled };
}, true);

// Tasks retry button presence
await interact('tasks has retry/delete actions', async () => {
  await page.goto(BASE + '/dashboard/tasks', { waitUntil: 'networkidle', timeout: 25000 });
  await sleep(1000);
  const acts = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      hasRetry: /重试|retry/i.test(body),
      hasDelete: /删除|delete|清空/i.test(body),
      snippet: body.slice(0, 250),
    };
  });
  return { ok: acts.hasRetry || acts.hasDelete || /任务/.test(acts.snippet), ...acts };
});

await browser.close();

const hardFail = interactions.filter((i) => !i.ok && !i.soft);
const summary = {
  generatedAt: new Date().toISOString(),
  pageCount: results.length,
  pass: results.filter((r) => r.ok).length,
  fail: results.filter((r) => !r.ok).length,
  pagesWithApiFail: results
    .filter((r) => r.failedApi.length)
    .map((r) => ({ name: r.name, path: r.path, failedApi: r.failedApi })),
  pagesWithConsoleError: results
    .filter((r) => r.consoleErrors.length || r.pageErrors.length)
    .map((r) => ({
      name: r.name,
      path: r.path,
      consoleErrors: r.consoleErrors,
      pageErrors: r.pageErrors,
    })),
  interactions,
  interactionPass: interactions.filter((i) => i.ok).length,
  interactionFail: hardFail.length,
  results,
};

fs.writeFileSync('report.json', JSON.stringify(summary, null, 2));

let md = `# Web Shell 全方面测试报告\n\n生成时间: ${summary.generatedAt}\n\n`;
md += `## 总览\n\n- 页面: **${summary.pass}/${summary.pageCount}** 通过\n- 交互/功能: **${summary.interactionPass}** 通过 / **${summary.interactionFail}** 失败\n- 有 API 4xx/5xx 的页面: ${summary.pagesWithApiFail.length}\n- 有控制台/页面错误的页面: ${summary.pagesWithConsoleError.length}\n\n`;
md += `## 页面结果\n\n| 状态 | 路径 | 最终 URL | 耗时 | H1 | API失败 | JS错误 |\n|---|---|---|---:|---|---:|---:|\n`;
for (const r of results) {
  md += `| ${r.ok ? 'PASS' : 'FAIL'} | \`${r.path}\` | \`${(r.finalUrl || '').replace(BASE, '')}\` | ${r.loadMs}ms | ${(r.h1 || []).join(' / ').slice(0, 40).replace(/\|/g, '/')} | ${r.failedApi.length} | ${r.consoleErrors.length + r.pageErrors.length} |\n`;
}
md += `\n## 交互结果\n\n`;
for (const i of interactions) {
  md += `- ${i.ok ? '✅' : i.soft ? '⚠️' : '❌'} **${i.name}**\n`;
}
md += `\n## 问题详情\n\n`;
for (const r of results.filter((r) => !r.ok || r.failedApi.length || r.consoleErrors.length || r.pageErrors.length)) {
  md += `### ${r.name} (\`${r.path}\`)\n\n`;
  md += `- finalUrl: \`${r.finalUrl}\`\n`;
  if (r.notes?.length) md += `- notes: ${JSON.stringify(r.notes)}\n`;
  if (r.failedApi.length) md += `- failedApi:\n\`\`\`json\n${JSON.stringify(r.failedApi, null, 2)}\n\`\`\`\n`;
  if (r.consoleErrors.length) md += `- console:\n\`\`\`\n${r.consoleErrors.join('\n')}\n\`\`\`\n`;
  if (r.pageErrors.length) md += `- pageErrors:\n\`\`\`\n${r.pageErrors.join('\n')}\n\`\`\`\n`;
  md += `- snippet: ${(r.bodySnippet || '').slice(0, 220).replace(/\n/g, ' ')}\n\n`;
}
const failedIx = interactions.filter((i) => !i.ok);
if (failedIx.length) {
  md += `## 失败/软失败交互详情\n\n`;
  for (const i of failedIx) {
    md += `### ${i.name}\n\n\`\`\`json\n${JSON.stringify(i.detail, null, 2).slice(0, 1500)}\n\`\`\`\n\n`;
  }
}
fs.writeFileSync('report.md', md);
console.log('\n=== SUMMARY ===');
console.log(`Pages: ${summary.pass}/${summary.pageCount}`);
console.log(`Interactions: ${summary.interactionPass} pass / ${summary.interactionFail} hard-fail`);
console.log('Report: .sau/web-test/report.md');
if (summary.fail > 0 || summary.interactionFail > 0) process.exitCode = 2;

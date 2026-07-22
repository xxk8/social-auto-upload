# SAU Web Shell — Frontend

可选可视化壳：**Vite + React 19 + TanStack Router（SPA）**。API 走 Flask `web_runner.py`，**不使用 TanStack Start / SSR**。

## 布局

| 路径 | 作用 |
|------|------|
| `src/main.tsx` | 浏览器入口（`createRoot` + `RouterProvider`） |
| `app/router.tsx` / `app/routeTree.gen.ts` | Router 工厂与生成树 |
| `app/routes/` | 文件路由（薄包装 → `src/features` / `src/Pages`） |
| `src/api/request.ts` | **唯一** axios 实例 + 拦截器 → Flask `/api/*` |
| `src/api/client.ts` | barrel：`request` re-export + `api.*` 聚合 |
| `src/features/` | 账号 / 发布 / 任务等业务 UI |

## 开发

```bash
# 仓库根目录：先起 Flask（:6001），并配置 CORS 或依赖 Vite proxy
python run.py

cd sau_web/frontend
npm install
npm run dev   # http://localhost:5174 ，/api 代理到 :6001
```

或一键：`bash sau_web/start.sh`（见仓库 [`docs/web-shell.md`](../../docs/web-shell.md)）。

## 构建

```bash
npm run build   # → dist/，由 Flask 托管
npm run test
```

## 包管理

**只用 npm**（`package-lock.json`）。不要提交 `pnpm-lock.yaml`。

## 目录约定

| 路径 | 说明 |
|------|------|
| `src/components/` | 共享 UI（小写 `c`，import `@/components/...`） |
| `src/pages/` | 页面组件（小写 `p`，import `@/pages/...`） |
| `src/features/` | 业务特性模块 |
| `app/routes/` | TanStack Router 文件路由（薄包装） |

Linux CI 大小写敏感：import 必须与目录真实大小写一致。

## 刻意不做的事

- 不引入 `@tanstack/react-start`
- 不用 `createServerFn` 包一层 Flask
- 不以 Web 用户 session 守卫 `/dashboard`（平台 cookie 在本机文件）

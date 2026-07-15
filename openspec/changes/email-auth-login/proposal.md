## Why

当前 Web 端没有任何用户认证机制——任何能访问 Flask :6001 端口的人都可以直接操作账号管理、发布任务、查看日志。随着项目从本地工具演变为团队协作平台，需要引入邮箱验证码登录功能，保护后台数据安全，同时为后续多用户角色（管理员/普通用户）奠定基础。

## What Changes

- 新增 `users` 表（id, email, password_hash, role, created_at, last_login）支持用户持久化
- 新增 `verification_codes` 表（email, code, purpose, expires_at, used）存储验证码，5 分钟过期，一次性使用
- 后端新增 `/api/auth/send-code` 发送验证码（SMTP）、`/api/auth/login` 验证码登录、`/api/auth/logout` 登出、`/api/auth/me` 获取当前用户
- 后端新增 Flask session 管理 + `@login_required` 装饰器保护所有现有 API
- 前端新增 `/login` 登录页面（邮箱输入 + 验证码输入两步表单）
- 前端新增 `AuthGuard` 路由守卫，未登录自动跳转 `/login`
- 前端新增 `useAuth` hook + Zustand auth store 管理登录状态
- SMTP 配置通过环境变量注入（`SAU_SMTP_HOST`, `SAU_SMTP_PORT`, `SAU_SMTP_USER`, `SAU_SMTP_PASS`）

## Capabilities

### New Capabilities

- `email-auth`: 邮箱验证码登录系统，包含用户注册/登录、验证码发送与校验、会话管理、路由守卫

### Modified Capabilities

- `frontend-polish`: 新增登录页面路由、AuthGuard 包裹现有路由、侧边栏显示当前用户信息与登出按钮

## Impact

- **Web API**: 新增 `web_runner/routes/auth.py` 蓝图，注册到 `create_app()`；所有现有路由需加 `@login_required` 保护
- **Frontend**: 新增 `src/Pages/LoginPage.tsx`、`src/features/auth/` 目录（AuthGuard、useAuth、authStore）；`App.tsx` 路由结构调整
- **Database**: 新增 `users` + `verification_codes` 两张表（SQLite + PostgreSQL 双方言）
- **依赖**: Python 端新增 `Flask-Login`（可选）或手写 session 装饰器；前端新增 `react-hook-form` + `zod` 做表单验证（复用 AdminCN 模板模式）
- **配置**: 新增 SMTP 环境变量，`.env.example` 需更新
- **Breaking**: 所有 `/api/*` 接口默认需要登录后才能访问（公开接口如 `/health`、`/api/auth/*` 除外）

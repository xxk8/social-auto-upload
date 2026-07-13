## Context

当前 SAU Web 端（Flask :6001 + React Vite :5174）无任何认证机制。所有 API 端点公开可访问。项目正在从单人本地工具向多人 Web 平台演进，需要引入用户认证保护数据安全。

现有架构：
- 后端：Flask `create_app()` 工厂模式，`web_runner/routes/` 下 Blueprint 注册
- 前端：React 19 + React Router v7 + Zustand + TanStack Query + axios `client.ts`
- 数据库：SQLite（开发）/ PostgreSQL（生产），`web_runner/db.py` 双方言初始化
- UI 组件库：shadcn/ui（Radix UI + Tailwind CSS v4），已有 Button/Input/Dialog/Card 等 30+ 组件
- SSE 端点：3 个（QR 扫码登录、上传进度、AI 流式生成），使用 `EventSource` / `fetch` 流式消费
- 部署模式：开发环境 Vite proxy（:5174 → :6001 同源）；生产环境可同域或跨域

## Goals / Non-Goals

**Goals:**
- 用户通过邮箱 + 6 位验证码登录（无密码，降低用户门槛）
- Flask session 保持登录状态（服务端签名 cookie，HttpOnly）
- 所有 `/api/*` 接口默认需要登录（白名单除外）
- SSE 端点支持认证（通过 session cookie 或一次性 token query param）
- 前端 `/login` 页面，未登录自动跳转
- 复用现有 shadcn/ui 组件，不引入新 UI 框架
- SMTP 发送验证码，通过环境变量配置
- 验证码过期自动清理，防止表膨胀

**Non-Goals:**
- 不做注册页面（首个用户自动成为管理员，后续用户需管理员审批）
- 不做 OAuth/第三方登录
- 不做密码登录（仅验证码）
- 不做 JWT token 方案（session 更简单，够用）
- 不做 RBAC 权限矩阵（本期仅区分 admin/user 两个角色，admin 可管理用户）

## Decisions

### 1. SECRET_KEY 管理

**选择**：`app.config["SECRET_KEY"]` 从环境变量 `SAU_SECRET_KEY` 读取；未设置时自动生成随机 key 并写入 `db/.secret_key` 文件持久化。

**理由**：
- Flask session 签名必须有 SECRET_KEY，当前 `create_app()` 完全未设置
- 环境变量优先（生产部署推荐），文件 fallback 免配置（开发体验好）
- 与现有 `SAU_CORS_ALLOWED_ORIGINS` 配置风格一致

**实现**：
```python
def _get_secret_key() -> str:
    key = os.environ.get("SAU_SECRET_KEY")
    if key:
        return key
    key_file = DB_DIR / ".secret_key"
    if key_file.exists():
        return key_file.read_text().strip()
    import secrets
    key = secrets.token_hex(32)
    key_file.write_text(key)
    return key
```

### 2. 认证方式：Flask Session + SSE Token 混合

**选择**：
- 普通 API：Flask session（签名 cookie，HttpOnly）
- SSE 端点：session cookie（同源时自动带） + 一次性 token query param（跨域 fallback）

**理由**：
- 项目已是 Flask 架构，session 零额外依赖
- `EventSource` API 不支持自定义 headers，跨域时无法带 cookie
- 一次性 token 方案：前端先调 `GET /api/auth/sse-token` 获取 5 分钟有效的 token，拼到 SSE URL 的 query param 中
- 开发环境（Vite proxy 同源）cookie 自动带，不需要 token

**替代方案**：JWT + localStorage → 拒绝（XSS 风险高，需额外 refresh token 机制）

### 3. CORS + Credentials 配置

**选择**：
- Flask-CORS 启用 `supports_credentials=True`
- 前端 axios 设置 `withCredentials: true`
- 前端 fetch 调用设置 `credentials: 'include'`

**理由**：
- 当前 CORS 配置缺少 `supports_credentials`，跨域部署时 cookie 不会被浏览器发送
- 生产环境如果前端和后端分域部署，必须启用 credentials
- Vite proxy 开发环境不受影响（同源自动带 cookie）

**注意**：`supports_credentials=True` 时 `origins` 不能用 `*`，必须指定具体域名（已有 `SAU_CORS_ALLOWED_ORIGINS` 环境变量控制）

### 4. 验证码存储与清理

**选择**：`verification_codes` 数据表 + 自动清理机制

**理由**：
- 和现有 `tasks`/`logs`/`account_groups` 表风格一致
- SQLite 和 PostgreSQL 都支持
- 重启不丢失未过期验证码

**清理策略**（三层）：
1. `send-code` 时顺便清理同 email 的过期记录（轻量，每次发码触发）
2. `create_app()` 启动时执行 `DELETE FROM verification_codes WHERE expires_at < now`（清理历史垃圾）
3. 可选：后台线程每小时清理一次全表过期记录

**替代方案**：Redis → 拒绝（项目无 Redis 依赖，引入过重）

### 5. 前端表单：react-hook-form + zod

**选择**：新增 `react-hook-form` + `zod` + `@hookform/resolvers`

**理由**：
- AdminCN 模板标准模式，与 shadcn/ui 生态深度集成
- shadcn/ui 的 Form 组件已内置 `react-hook-form` 集成
- zod schema 验证类型安全，和 TypeScript 天然配合

**替代方案**：手写 useState 表单 → 拒绝（重复代码多，验证逻辑散落）

### 6. 路由保护：前端 AuthGuard + 后端 @login_required 双层

**选择**：
- 前端：React Router `<AuthGuard>` 包裹受保护路由，未登录重定向 `/login`
- 后端：`@login_required` 装饰器检查 `session["user_id"]`，未登录返回 401
- `@login_required` 仅在 `SAU_AUTH_ENABLED != "false"` 时生效（测试/开发开关）

**理由**：
- 前端保护用户体验（不闪现无权限页面）
- 后端保护是真正的安全屏障（防止 curl/Postman 绕过）
- 401 响应触发前端全局 interceptor 跳转登录页

**安全约束**：`SAU_AUTH_ENABLED=false` 仅在 `FLASK_DEBUG=1` 或 `FLASK_ENV=development` 时允许，生产环境忽略此开关。

### 7. SMTP 配置：环境变量注入

**选择**：`SAU_SMTP_HOST`、`SAU_SMTP_PORT`、`SAU_SMTP_USER`、`SAU_SMTP_PASS`、`SAU_SMTP_FROM` 环境变量

**理由**：
- 与现有 `SAU_CORS_ALLOWED_ORIGINS` 配置风格一致
- `.env.example` 统一管理
- 不硬编码邮箱凭据到代码

### 8. 首个管理员竞态保护

**选择**：数据库层面用 `INSERT ... ON CONFLICT` + 事务保护

**理由**：
- 两个用户同时提交登录时，`SELECT COUNT(*) = 0` 可能都通过
- 解决方案：login 端点内用 `db.transaction()` 包裹「检查用户数 → 插入新用户」
- SQLite 单写锁天然串行化；PostgreSQL 用 `SELECT ... FOR UPDATE` 或 `INSERT ON CONFLICT DO NOTHING`

### 9. 组件复用策略

**选择**：直接使用现有 shadcn/ui 组件拼装登录页

复用清单：
- `Input` → 邮箱输入框、验证码输入框
- `Button` → 发送验证码按钮、登录按钮
- `Card` → 登录表单容器
- `Label` → 表单标签
- `Alert` → 错误提示
- `toast` → 成功/失败通知

新增组件：
- `src/features/auth/AuthGuard.tsx` → 路由守卫
- `src/features/auth/useAuth.ts` → 认证 hook
- `src/features/auth/authApi.ts` → 认证 API 调用

## Risks / Trade-offs

| 风险 | 缓解措施 |
|------|----------|
| SMTP 邮件进垃圾箱 | 支持配置多个 SMTP 提供商；文档说明推荐 QQ/163/Gmail |
| 验证码暴力破解 | 60 秒限频 + 5 次失败锁定 15 分钟 + 验证码 6 位数字 |
| Session 固定攻击 | 登录成功后删除旧 session 并创建新 session（显式实现，非 Flask 默认行为） |
| 验证码表膨胀 | 三层清理：发码时清理同 email + 启动时全表清理 + 可选定时清理 |
| 首个管理员竞态 | 数据库事务 + INSERT ON CONFLICT 保护 |
| SSE 端点认证 | 同源用 session cookie，跨域用一次性 token query param |
| SECRET_KEY 泄露 | 环境变量优先；文件 fallback 仅用于开发，文件权限 600 |
| SAU_AUTH_ENABLED 误用 | 仅 debug 模式允许跳过认证 |

## Migration Plan

1. **Phase 0 — 基础设施**：`create_app()` 设置 SECRET_KEY → CORS 启用 credentials → 前端 axios/fetch 添加 withCredentials
2. **Phase 1 — 后端**：新增 `users` + `verification_codes` 表 → auth 路由 → `@login_required` 装饰器 → SSE token 端点
3. **Phase 2 — 前端**：LoginPage → AuthGuard → useAuth hook → App.tsx 路由调整 → SSE 调用改用 token
4. **Phase 3 — 集成**：SMTP 配置 → 端到端测试 → 文档更新

回滚策略：`@login_required` 装饰器支持环境变量 `SAU_AUTH_ENABLED=false` 禁用（仅 debug 模式）

## Open Questions

- SMTP 发件频率是否需要全局限频（当前仅按邮箱限频）？
- 管理员审批新用户的 UI 是否在本期范围内（暂定 Non-Goal，后续迭代）？

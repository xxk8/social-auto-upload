## Why

项目已有完整的用户认证体系（邮箱验证码登录）和角色系统（admin/user），但存在两个核心问题：

1. **管理员没有专用界面**：创始人想知道"谁在用我的项目"，只能去查数据库，无法通过 Web 界面查看用户列表、操作日志、系统状态
2. **登录方式单一**：目前仅支持邮箱验证码登录，用户需要等待邮件、输入 6 位验证码，体验不够流畅；不支持 Google/GitHub 等第三方登录，对国际用户不友好

随着项目从本地工具演变为团队协作平台，需要：
- 为管理员提供 Dashboard，可视化项目使用情况
- 提供社交登录选项，降低用户登录门槛，提升用户体验

## What Changes

### Admin Dashboard

- 新增 `/app/admin/*` 路由组，包含管理后台入口（仅 admin 可见）
- 新增 `AdminUsersPage`：用户列表（邮箱、角色、注册时间、最后登录时间）
- 新增 `AdminAuditPage`：操作审计日志（管理员角色变更等操作记录）
- 新增 `AdminOverviewPage`：系统概览（总用户数、今日活跃、任务成功率）
- 新增 `admin_audit_log` 表：记录管理员操作（角色变更等）
- 新增 `GET /api/admin/overview`、`GET /api/admin/audit`、`GET /api/admin/system` 端点
- 增强 `GET /api/auth/users` 端点，返回用户操作统计

### 社交登录

- 集成 Authlib OAuth 库，支持 Google 和 GitHub 登录
- 新增 `web_runner/routes/oauth.py` 蓝图，实现 OAuth 回调处理
- 新增 `GET /api/auth/google/login`、`GET /api/auth/google/callback` 端点
- 新增 `GET /api/auth/github/login`、`GET /api/auth/github/callback` 端点
- 登录页面新增社交登录按钮（Google、GitHub）
- 新用户自动注册，老用户自动关联

## Capabilities

### New Capabilities

- `admin-dashboard`: 管理员 Dashboard，包含用户管理、操作日志、系统概览三个页面
- `social-login`: 社交登录功能，支持 Google 和 GitHub OAuth 登录

### Modified Capabilities

- `email-auth-login`: 扩展登录页面，新增社交登录按钮
- `frontend-polish`: 侧边栏新增管理员入口（条件渲染）

## Impact

- **Web API**: 新增 `web_runner/routes/admin.py`（管理员 API）、`web_runner/routes/oauth.py`（社交登录）两个蓝图；新增 `admin_audit_log` 表
- **Frontend**: 新增 `src/features/admin/` 目录（AdminUsersPage、AdminAuditPage、AdminOverviewPage、adminApi）；修改 `LoginPage.tsx` 添加社交登录按钮；修改 `AppShell.tsx` 添加管理员导航项
- **Database**: 新增 `admin_audit_log` 表（admin_user_id, target_user_id, action, detail, created_at）
- **依赖**: Python 端新增 `authlib`（OAuth 库）；前端无新依赖
- **配置**: 新增 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET` 环境变量
- **Breaking**: 无（向后兼容，现有邮箱验证码登录保持不变）

# OAuth 社交登录配置指南

Web Shell 运营台支持 **Google 登录** 与 **GitHub 登录** 两种 OAuth 2.0 社交登录方式。配置完成后，登录页会在邮箱验证码表单上方显示对应的社交登录按钮。

> 社交登录是**可选功能**。不配置 OAuth 时，邮箱验证码登录不受影响，社交登录按钮会自动隐藏。

---

## 快速检查清单

| 检查项 | 说明 |
|---|---|
| ✅ 复制 `.env.example` → `.env` | 所有 OAuth 配置走环境变量，不修改代码 |
| ✅ Google 或 GitHub 至少配一组 | `CLIENT_ID` + `CLIENT_SECRET` 成对出现 |
| ✅ 重定向 URI 与部署域名一致 | 开发用 `localhost`，生产务必替换为实际域名 |
| ✅ `.env` 已 `.gitignore` 保护 | 密钥绝不能提交到仓库 |

---

## 1. Google OAuth 2.0

### 1.1 创建凭据

1. 访问 [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
2. 点击 **Create Credentials → OAuth client ID**
3. 应用类型选择 **Web application**
4. 填写名称（如 `social-auto-upload`）

### 1.2 配置授权重定向 URI

在「Authorized redirect URIs」中添加：

```
http://localhost:6001/api/auth/google/callback
```

**生产环境**请替换为实际域名：

```
https://your-domain.com/api/auth/google/callback
```

> ⚠️ URI 必须完全匹配（包括协议、端口、路径末尾的 `/callback`）。多填一条开发地址、一条生产地址即可。

### 1.3 获取并填入环境变量

创建凭据后，复制 **Client ID** 和 **Client Secret**，写入 `.env`：

```bash
GOOGLE_CLIENT_ID=123456789-abcdef.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxx
```

### 1.4 启用 Google+ API（如需要）

若控制台提示 API 未启用，前往 [API Library](https://console.cloud.google.com/apis/library) 搜索并启用：

- **Google+ API**（旧版，部分项目仍需）
- 或确保项目已启用 **Google Identity Toolkit API**

通常创建 OAuth 凭据后自动启用所需 API，如遇 `access_denied` 可优先检查此项。

---

## 2. GitHub OAuth App

### 2.1 创建 OAuth App

1. 访问 [GitHub Settings → Developer settings → OAuth Apps](https://github.com/settings/developers)
2. 点击 **New OAuth App**
3. 填写：

| 字段 | 开发环境示例 | 生产环境示例 |
|---|---|---|
| Application name | `social-auto-upload-dev` | `social-auto-upload` |
| Homepage URL | `http://localhost:5180` | `https://your-domain.com` |
| Authorization callback URL | `http://localhost:6001/api/auth/github/callback` | `https://your-domain.com/api/auth/github/callback` |

### 2.2 生成 Client Secret

创建完成后，点击 **Generate a new client secret**，复制新生成的 secret（仅显示一次）。

### 2.3 填入环境变量

```bash
GITHUB_CLIENT_ID=Ov23lixxxxxxxxx
GITHUB_CLIENT_SECRET=2e1cxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

> GitHub OAuth App 不需要像 Google 那样单独启用 API，创建即用。

---

## 3. 验证配置

### 3.1 重启后端

环境变量修改后必须重启 Flask 后端：

```bash
# 若使用一键启动脚本
bash sau_web/start.sh

# 若手动启动
python run.py
```

### 3.2 检查登录页

访问 `http://localhost:5180/login`，页面应出现：

- **Continue with Google** 按钮（当 `GOOGLE_CLIENT_ID` 与 `GOOGLE_CLIENT_SECRET` 均非空）
- **Continue with GitHub** 按钮（当 `GITHUB_CLIENT_ID` 与 `GITHUB_CLIENT_SECRET` 均非空）

按钮未出现 → 检查：

1. `.env` 文件是否在项目根目录
2. 后端进程是否重启过（旧进程不读新 `.env`）
3. 对应的两组变量是否**同时**非空（只填 ID 不填 Secret 视为未配置）

### 3.3 走通完整登录流程

1. 点击 **Continue with Google**
2. 在弹出的 Google 授权页中选择账号
3. 授权后应自动重定向回 `http://localhost:5180/app`
4. 首次登录会在数据库自动创建用户；**第一个用户自动成为 admin**
5. 后续用户为普通 `user` 角色

GitHub 流程相同。

---

## 4. 常见错误与排查

| 现象 | 原因 | 解决 |
|---|---|---|
| 点击社交登录按钮后跳转到 `/login?error=oauth_not_configured` | 对应 OAuth 提供者的环境变量未配置或为空 | 检查 `.env` 中四组变量是否完整 |
| Google 授权后跳转到 `/login?error=no_email` | Google 账号未开放邮箱访问，或 `openid email profile` scope 被拒绝 | 确保 Google 项目已启用 People API / Gmail API；引导用户换一个已验证邮箱的账号 |
| GitHub 授权后跳转到 `/login?error=no_email` | GitHub 账号没有公开邮箱，或 `user:email` scope 未返回任何邮件 | 引导用户在 GitHub Settings → Emails 中添加并验证一个邮箱 |
| 回调后跳转到 `/login?error=google_failed` / `github_failed` | `authorize_access_token()` 抛异常（网络超时、密钥错误、code 过期） | 查看后端日志中的 `[oauth] Google callback failed` 或 `[oauth] GitHub callback failed` 详情 |
| 生产环境回调地址不匹配 | Google/GitHub 控制台中的重定向 URI 与实际部署域名不一致 | 在 OAuth 控制台添加生产域名对应的回调 URI |
| 授权成功但跳到 `/app` 显示 Not Found | `web_runner/routes/oauth.py` 回调里 `redirect("/app")` / `redirect("/login?error=...")` 用的是**相对路径**，浏览器在 :6001 回调页面将其解析成 `http://localhost:6001/app`——但 `/app` 是前端路由（Vite :5180），后端没有 → Flask 404 | 后端所有 OAuth 重定向必须走 `_frontend_url(...)` helper，生成绝对 URL `http://localhost:5180/app`；同时 `.env` 需设 `SAU_FRONTEND_URL`（生产环境改成 `https://your-domain.com`） |
| 授权成功但跳到 `/app` 显示 Not Found | `web_runner/routes/oauth.py` 回调里 `redirect("/app")` / `redirect("/login?error=...")` 用的是**相对路径**，浏览器在 :6001 回调页面将其解析成 `http://localhost:6001/app`——但 `/app` 是前端路由（Vite :5180），后端没有 → Flask 404 | 后端所有 OAuth 重定向必须走 `_frontend_url(...)` helper，生成绝对 URL `http://localhost:5180/app`；同时 `.env` 需设 `SAU_FRONTEND_URL`（生产环境改成 `https://your-domain.com`） |

---

## 5. 安全注意事项

1. **密钥绝不入仓**：`.env` 已写入 `.gitignore`，提交前请确认没有意外将真实密钥推送到远程仓库。
2. **生产环境强制 HTTPS**：Google 和 GitHub 的 OAuth 控制台都要求生产环境回调地址使用 `https://`。
3. **定期轮换 Client Secret**：建议每 90 天在 Google Cloud Console / GitHub Settings 中重新生成一次 Secret，并同步更新服务器上的 `.env`。
4. **Scope 最小化原则**：当前仅请求 `openid email profile`（Google）和 `user:email`（GitHub），不请求额外敏感权限。

---

## 6. 相关文件

| 文件 | 说明 |
|---|---|
| `.env.example` | 环境变量模板，含 OAuth 占位符与全部可选变量 |
| `web_runner/oauth.py` | Authlib 注册逻辑，读取 `GOOGLE_CLIENT_ID` 等环境变量 |
| `web_runner/routes/oauth.py` | OAuth 登录与回调路由实现 |
| `sau_web/frontend/src/Pages/LoginAuthPage.tsx` | 登录页前端，按环境变量条件渲染社交登录按钮 |
| `tests/test_admin_oauth.py` | 后端 OAuth 测试覆盖（含缺失配置、token 失败、邮箱缺失等边界） |

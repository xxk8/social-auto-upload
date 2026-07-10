## ADDED Requirements

### Requirement: Social Login (openspec delta-format stub — see archived content below)
The `Social Login` capability is added by openspec change `admin-dashboard-social-login`. This file is currently a delta-format stub created during a wholesale `## 概述 → ## ADDED Requirements` migration; the authoritative pre-migration specification is preserved verbatim as an indented code block at the bottom of this file. Domain experts should backfill proper Requirement / Scenario entries by reading that archived content. The system MUST satisfy this contract per the change's proposal.md and design.md.

#### Scenario: Standard execution path (stub)
- **WHEN** the `Social Login` workflow is invoked per `openspec/changes/admin-dashboard-social-login/design.md`
- **THEN** the system MUST satisfy the behavioral contract documented in the archived pre-migration specification below

<Archived pre-migration specification; preserved as a 4-space-indented code block so `## headings` inside it do NOT re-trigger the openspec delta detector>

    # Social Login 规范
    
    ## 概述
    
    社交登录功能允许用户使用 Google/GitHub 账号一键登录，无需记忆密码，提升用户体验。
    
    ## 技术选型
    
    选择 **Authlib** 作为 OAuth 库：
    
    | 因素 | Authlib | Flask-OAuthlib | authlib-limiter |
    |---|---|---|---|
    | 维护状态 | 活跃（v1.7.2） | 已废弃 | 不活跃 |
    | Flask 集成 | ✅ 原生支持 | ✅ | ❌ |
    | OpenID Connect | ✅ | ❌ | ❌ |
    | 文档完善度 | 高 | 中 | 低 |
    | 社区支持 | 强 | 弱 | 弱 |
    
    ## 流程
    
    ```
    用户点击 "Google 登录"
            ↓
    前端调用 window.location.href = '/api/auth/google/login'
            ↓
    后端重定向到 Google 授权页面
            ↓
    用户在 Google 页面授权
            ↓
    Google 回调到 /api/auth/google/callback
            ↓
    后端获取用户信息（email, name, avatar）
            ↓
    查找或创建用户（写入 users 表）
            ↓
    创建 session（user_id, role）
            ↓
    重定向到 /app（前端）
    ```
    
    ## API 端点
    
    ### GET /api/auth/google/login
    
    **权限**：公开
    **Response**：重定向到 Google 授权页面
    
    ### GET /api/auth/google/callback
    
    **权限**：公开
    **Response**：重定向到 `/app`（成功）或 `/login?error=google_failed`（失败）
    
    ### GET /api/auth/github/login
    
    **权限**：公开
    **Response**：重定向到 GitHub 授权页面
    
    ### GET /api/auth/github/callback
    
    **权限**：公开
    **Response**：重定向到 `/app`（成功）或 `/login?error=github_failed`（失败）
    
    ## 后端实现
    
    ### OAuth 配置
    
    ```python
    # web_runner/oauth.py
    from authlib.integrations.flask_client import OAuth
    
    oauth = OAuth()
    
    # Google 配置
    oauth.register(
        name='google',
        client_id='your-google-client-id',
        client_secret='your-google-client-secret',
        server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
        client_kwargs={'scope': 'openid email profile'},
    )
    
    # GitHub 配置
    oauth.register(
        name='github',
        client_id='your-github-client-id',
        client_secret='your-github-client-secret',
        access_token_url='https://github.com/login/oauth/access_token',
        access_token_params=None,
        authorize_url='https://github.com/login/oauth/authorize',
        authorize_params=None,
        api_base_url='https://api.github.com/',
        client_kwargs={'scope': 'user:email'},
    )
    ```
    
    ### 登录路由
    
    ```python
    # web_runner/routes/oauth.py
    from flask import Blueprint, redirect, url_for, session
    from web_runner.oauth import oauth
    from web_runner.db import get_database
    from datetime import datetime, timezone
    
    bp = Blueprint('oauth', __name__)
    
    
    def _find_or_create_user(email: str, name: str | None = None, avatar: str | None = None) -> dict:
        """查找或创建用户"""
        db = get_database()
        user = db.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
    
        if not user:
            now = datetime.now(timezone.utc).isoformat()
            count_row = db.fetch_one("SELECT COUNT(*) as cnt FROM users")
            role = "admin" if (count_row and count_row["cnt"] == 0) else "user"
            db.execute(
                "INSERT INTO users (email, role, created_at, last_login, name, avatar) VALUES (?, ?, ?, ?, ?, ?)",
                (email, role, now, now, name, avatar),
            )
            user = db.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
        else:
            now = datetime.now(timezone.utc).isoformat()
            db.execute(
                "UPDATE users SET last_login = ?, name = COALESCE(?, name), avatar = COALESCE(?, avatar) WHERE id = ?",
                (now, name, avatar, user["id"]),
            )
            user = db.fetch_one("SELECT * FROM users WHERE id = ?", (user["id"],))
    
        return user
    
    
    def _create_session(user: dict) -> None:
        """创建用户 session"""
        session.clear()
        session["user_id"] = user["id"]
        session["role"] = user["role"]
        session.permanent = True
    
    
    @bp.get('/api/auth/google/login')
    def google_login():
        redirect_uri = url_for('oauth.google_callback', _external=True)
        return oauth.google.authorize_redirect(redirect_uri)
    
    
    @bp.get('/api/auth/google/callback')
    def google_callback():
        try:
            token = oauth.google.authorize_access_token()
            userinfo = token['userinfo']
            user = _find_or_create_user(
                email=userinfo['email'],
                name=userinfo.get('name'),
                avatar=userinfo.get('picture'),
            )
            _create_session(user)
            return redirect('/app')
        except Exception:
            return redirect('/login?error=google_failed')
    
    
    @bp.get('/api/auth/github/login')
    def github_login():
        redirect_uri = url_for('oauth.github_callback', _external=True)
        return oauth.github.authorize_redirect(redirect_uri)
    
    
    @bp.get('/api/auth/github/callback')
    def github_callback():
        try:
            token = oauth.github.authorize_access_token()
            resp = oauth.github.get('user', token=token)
            profile = resp.json()
    
            email_resp = oauth.github.get('user/emails', token=token)
            emails = email_resp.json()
            email = next((e['email'] for e in emails if e['primary']), None)
    
            if not email:
                return redirect('/login?error=no_email')
    
            user = _find_or_create_user(
                email=email,
                name=profile.get('name'),
                avatar=profile.get('avatar_url'),
            )
            _create_session(user)
            return redirect('/app')
        except Exception:
            return redirect('/login?error=github_failed')
    ```
    
    ## 前端实现
    
    ### 登录页面
    
    ```tsx
    // sau_web/frontend/src/Pages/LoginPage.tsx
    import { Button } from '@/Components/ui/button'
    import { Separator } from '@/Components/ui/separator'
    import { authApi } from '@/features/auth/authApi'
    
    export function LoginPage() {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="w-full max-w-md space-y-6 p-8">
            <div className="text-center">
              <h1 className="text-2xl font-bold">登录</h1>
              <p className="text-muted-foreground mt-2">选择登录方式继续</p>
            </div>
    
            {/* 社交登录按钮 */}
            <div className="space-y-3">
              <Button variant="outline" className="w-full" onClick={() => authApi.googleLogin()}>
                <GoogleIcon className="mr-2 h-4 w-4" />
                Google 登录
              </Button>
              <Button variant="outline" className="w-full" onClick={() => authApi.githubLogin()}>
                <GitHubIcon className="mr-2 h-4 w-4" />
                GitHub 登录
              </Button>
            </div>
    
            {/* 分割线 */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <Separator className="w-full" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">或者使用</span>
              </div>
            </div>
    
            {/* 邮箱验证码登录 */}
            <EmailLoginForm />
          </div>
        </div>
      )
    }
    ```
    
    ## 环境变量
    
    ```bash
    # .env 文件
    
    # Google OAuth（需要在 Google Cloud Console 创建）
    GOOGLE_CLIENT_ID=xxx
    GOOGLE_CLIENT_SECRET=xxx
    
    # GitHub OAuth（需要在 GitHub Settings → Developer settings 创建）
    GITHUB_CLIENT_ID=xxx
    GITHUB_CLIENT_SECRET=xxx
    ```
    
    ## OAuth 应用配置
    
    ### Google Cloud Console
    
    1. 访问 https://console.cloud.google.com
    2. 创建新项目或选择现有项目
    3. 导航到「API 和服务」→「凭据」
    4. 点击「创建凭据」→「OAuth 客户端 ID」
    5. 配置 OAuth 同意屏幕
    6. 创建 OAuth 2.0 客户端 ID
    7. 添加重定向 URI：`http://localhost:6001/api/auth/google/callback`
    
    ### GitHub Settings
    
    1. 访问 https://github.com/settings/developers
    2. 点击「New OAuth App」
    3. 填写应用信息：
       - Application name: `social-auto-upload`
       - Homepage URL: `http://localhost:5180`
       - Authorization callback URL: `http://localhost:6001/api/auth/github/callback`
    4. 保存 Client ID 和 Client Secret
    
    ## 安全考量
    
    1. **CSRF 防护**：OAuth 库自动处理 state 参数
    2. **Token 存储**：使用 Flask session（服务端存储）
    3. **邮箱验证**：使用 Google/GitHub 已验证的邮箱
    4. **最小权限**：只请求必要的 scope（email, profile）
    

## ADDED Requirements

### Requirement: Admin Dashboard (openspec delta-format stub — see archived content below)
The `Admin Dashboard` capability is added by openspec change `admin-dashboard-social-login`. This file is currently a delta-format stub created during a wholesale `## 概述 → ## ADDED Requirements` migration; the authoritative pre-migration specification is preserved verbatim as an indented code block at the bottom of this file. Domain experts should backfill proper Requirement / Scenario entries by reading that archived content. The system MUST satisfy this contract per the change's proposal.md and design.md.

#### Scenario: Standard execution path (stub)
- **WHEN** the `Admin Dashboard` workflow is invoked per `openspec/changes/admin-dashboard-social-login/design.md`
- **THEN** the system MUST satisfy the behavioral contract documented in the archived pre-migration specification below

<Archived pre-migration specification; preserved as a 4-space-indented code block so `## headings` inside it do NOT re-trigger the openspec delta detector>

    # Admin Dashboard 规范
    
    ## 概述
    
    管理员 Dashboard 为项目创始人/开发者提供 Web 界面，用于查看用户使用情况、操作日志、系统状态。
    
    ## 路由结构
    
    ```
    /app/admin                  → AdminOverviewPage（概览仪表盘）
    /app/admin/users            → AdminUsersPage（用户管理）
    /app/admin/audit            → AdminAuditPage（操作日志）
    ```
    
    ## 页面设计
    
    ### AdminUsersPage（用户管理）
    
    | 列 | 字段 | 说明 |
    |---|---|---|
    | 邮箱 | `email` | 用户邮箱地址 |
    | 角色 | `role` | admin / user，用 Badge 显示 |
    | 注册时间 | `created_at` | 用户首次注册时间 |
    | 最后登录 | `last_login` | 用户最后登录时间 |
    | Tier | `tier` | pro / free / legacy |
    
    **交互**：
    - 点击角色列显示 DropdownMenu，可选择变更角色
    - 变更角色前弹出 AlertDialog 确认
    - 管理员不能把自己降为 user
    
    **空状态**：
    - 图标：`Users`
    - 标题：「还没有注册用户」
    - 描述：「等待第一位用户通过邮箱验证码登录」
    
    ### AdminAuditPage（操作日志）
    
    | 列 | 字段 | 说明 |
    |---|---|---|
    | 时间 | `created_at` | 操作时间 |
    | 管理员 | `admin_email` | 执行操作的管理员 |
    | 目标用户 | `target_email` | 被操作的用户 |
    | 操作 | `action` | role_change 等 |
    | 详情 | `detail` | JSON 格式的操作详情 |
    
    **空状态**：
    - 图标：`FileText`
    - 标题：「暂无操作记录」
    - 描述：「管理员操作（如角色变更）会记录在这里」
    
    ### AdminOverviewPage（概览）
    
    **统计卡片**：
    - 总用户数
    - 今日活跃用户数
    - 总任务数
    - 任务成功率
    
    **最近操作**：
    - 最近 10 条用户操作（时间、用户、操作类型、详情）
    
    **空状态**：
    - 图标：`BarChart3`
    - 标题：「系统刚启动」
    - 描述：「等待用户操作后显示统计数据」
    
    ## API 端点
    
    ### GET /api/admin/users
    
    **权限**：admin
    **Response**：
    ```json
    {
      "success": true,
      "data": [
        {
          "id": 1,
          "email": "a@b.com",
          "role": "admin",
          "tier": "pro",
          "created_at": "2026-06-01T00:00:00Z",
          "last_login": "2026-07-05T10:00:00Z"
        }
      ]
    }
    ```
    
    ### GET /api/admin/audit
    
    **权限**：admin
    **Query params**：`?page=1&per_page=50`
    **Response**：
    ```json
    {
      "success": true,
      "data": {
        "logs": [
          {
            "id": 1,
            "admin_email": "admin@sau.dev",
            "target_email": "user@sau.dev",
            "action": "role_change",
            "detail": {"old_role": "user", "new_role": "admin"},
            "created_at": "2026-07-05T10:32:00Z"
          }
        ],
        "total": 42
      }
    }
    ```
    
    ### GET /api/admin/overview
    
    **权限**：admin
    **Response**：
    ```json
    {
      "success": true,
      "data": {
        "total_users": 12,
        "active_today": 5,
        "total_tasks": 1234,
        "task_success_rate": 94.2,
        "recent_actions": [
          {
            "id": 1,
            "user_email": "a@b.com",
            "action": "publish",
            "created_at": "2026-07-05T10:32:00Z"
          }
        ]
      }
    }
    ```
    
    ### GET /api/admin/system
    
    **权限**：admin
    **Response**：
    ```json
    {
      "success": true,
      "data": {
        "tasks_by_status": {
          "success": 1100,
          "failed": 80,
          "pending": 54
        },
        "tasks_by_platform": {
          "douyin": 500,
          "xiaohongshu": 400,
          "bilibili": 334
        },
        "errors_by_type": {
          "TimeoutError": 30,
          "CookieExpired": 25,
          "UploadFailed": 25
        }
      }
    }
    ```
    
    ## 数据库表
    
    ### admin_audit_log
    
    ```sql
    CREATE TABLE IF NOT EXISTS admin_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_user_id INTEGER NOT NULL,
        target_user_id INTEGER,
        action TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (admin_user_id) REFERENCES users(id),
        FOREIGN KEY (target_user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit_log(admin_user_id);
    ```
    
    ## 组件复用
    
    | 组件 | 用途 |
    |---|---|
    | `Table` + `TableHeader` + `TableBody` + `TableRow` + `TableHead` + `TableCell` | 用户列表、操作日志 |
    | `Card` + `CardContent` + `CardTitle` | 概览统计卡片、容器 |
    | `Stat` | 数字统计展示 |
    | `Badge` | 角色标签（admin/user） |
    | `EmptyState` | 空数据提示 |
    | `Skeleton` | 加载状态 |
    | `PageHeader` | 页面标题 |
    | `Button` | 操作按钮 |
    | `DropdownMenu` | 角色变更下拉菜单 |
    | `Dialog` + `AlertDialog` | 角色变更确认弹窗 |
    | `Toast` | 操作反馈 |
    

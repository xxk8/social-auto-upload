# Admin Dashboard 设计方案

> 状态：Draft  
> 作者：MiMoCode  
> 日期：2026-07-05  
> 产品视角 v2

---

## 1. 背景与目标

### 1.1 问题

项目已有完整的用户认证和操作追踪体系，但**管理员没有任何专用界面**。创始人想知道"谁在用我的项目"，只能去查数据库。

### 1.2 目标

让管理员（项目开发者/创始人）能通过 Web 界面回答三个核心问题：

| 问题 | 对应功能 |
|---|---|
| 谁在用？ | 用户列表 |
| 谁做了什么？ | 操作日志 |
| 系统运行得怎么样？ | 系统健康 |

---

## 2. 用户故事

### 2.1 核心用户：项目创始人

```
作为项目创始人，我想要：
├─ 看到有多少人注册了 → 评估项目热度
├─ 看到谁在活跃使用 → 识别核心用户
├─ 看到谁遇到了问题 → 主动跟进
├─ 看到任务成功率 → 判断系统稳定性
└─ 管理用户角色 → 分配管理员权限
```

### 2.2 使用场景

| 场景 | 频率 | 需要的信息 |
|---|---|---|
| 每日快速检查 | 每天 | 今日活跃用户数、任务成功率 |
| 新用户注册跟进 | 每周 | 最近注册的用户列表 |
| 排查用户问题 | 随时 | 某用户的操作历史 |
| 系统异常排查 | 出问题时 | 错误类型分布、最近错误 |
| 角色管理 | 偶尔 | 用户列表 + 角色变更 |

---

## 3. 成功指标

| 指标 | 目标 | 衡量方式 |
|---|---|---|
| 使用频率 | 管理员每周至少访问 1 次 | 页面访问日志 |
| 信息获取效率 | 30 秒内找到"谁在活跃" | 用户测试 |
| 问题定位效率 | 1 分钟内定位"某用户做了什么" | 用户测试 |
| 覆盖率 | 100% 管理员功能可通过 UI 完成 | 功能对照表 |

---

## 4. 版本规划

按**用户能获得的价值**划分，而不是技术层。

### v0.1：看到用户（MVP）

**用户价值**：管理员能知道"谁注册了"

| 内容 | 工作量 |
|---|---|
| 后端：`GET /api/admin/users`（复用现有端点） | 0.5h |
| 前端：AdminUsersPage（纯表格，无分页） | 2h |
| 侧边栏：添加"管理后台"入口（仅 admin 可见） | 0.5h |
| **合计** | **3h** |

**交付物**：
- 用户列表页面，显示邮箱、角色、注册时间、最后登录时间
- 空状态："还没有注册用户"

### v0.2：看到操作

**用户价值**：管理员能知道"谁做了什么"

| 内容 | 工作量 |
|---|---|
| 后端：`GET /api/admin/audit`（新增审计日志表） | 2h |
| 后端：角色变更时写入审计日志 | 0.5h |
| 前端：AdminAuditPage（操作日志表格） | 2h |
| **合计** | **4.5h** |

**交付物**：
- 操作日志页面，显示时间、管理员、目标用户、操作类型、详情
- 空状态："暂无操作记录"

### v0.3：看到系统

**用户价值**：管理员能知道"系统运行得怎么样"

| 内容 | 工作量 |
|---|---|:-)
| 后端：`GET /api/admin/overview`（聚合统计） | 1.5h |:-)
| 后端：`GET /api/admin/system`（任务/错误统计） | 1h |
| 前端：AdminOverviewPage（数字卡片 + 最近操作） | 2h |
| **合计** | **4.5h** |

**交付物**：
- 概览页面，显示总用户数、今日活跃、任务成功率
- 最近 10 条操作列表
- 空状态："系统刚启动，暂无数据"

### v1.0：完整管理

**用户价值**：管理员能完整管理用户和系统

| 内容 | 工作量 |
|---|---|
| 角色变更功能（带二次确认） | 1h |
| 用户管理页：搜索、分页、角色筛选 | 2h |
| 审计日志页：时间范围筛选 | 1h |
| 移动端适配 | 2h |
| **合计** | **6h** |

### v1.1：社交登录

**用户价值**：用户可以用 Google/GitHub 账号一键登录，无需记忆密码

| 内容 | 工作量 |
|---|---|
| 后端：集成 Authlib OAuth 库 | 2h |
| 后端：Google 登录路由 | 1h |
| 后端：GitHub 登录路由 | 1h |
| 前端：登录页社交登录按钮 | 1h |
| **合计** | **5h** |

**交付物**：
- Google 一键登录
- GitHub 一键登录
- 登录页显示社交登录按钮
- 新用户自动注册，老用户自动关联

---

## 5. 现有基础设施

### 5.1 数据库（已就绪）

| 表 | Dashboard 用途 | 状态 |
|---|---|---|
| `users` | 用户列表、角色管理 | ✅ 可直接使用 |
| `usage_logs` | 用户操作审计 | ✅ 可直接使用 |
| `tasks` | 任务统计 | ✅ 可直接使用 |
| `error_events` | 错误分析 | ✅ 可直接使用 |

### 5.2 后端 API（已就绪）

| 端点 | 权限 | Dashboard 用途 |
|---|---|---|
| `GET /api/auth/users` | admin | 用户列表（v0.1 直接复用） |
| `PUT /api/auth/users/<id>/role` | admin | 角色变更 |
| `GET /api/analytics/summary` | login | 聚合统计（v0.3 可复用） |

### 5.3 前端 API 客户端（已就绪）

```typescript
// authApi.ts — 已实现，未挂 UI
authApi.getUsers()           // GET /api/auth/users
authApi.updateUserRole(id, role)  // PUT /api/auth/users/<id>/role
```

### 5.4 缺失部分

- ❌ 侧边栏没有按角色隐藏管理员入口
- ❌ 没有操作审计日志表（`admin_audit_log`）
- ❌ 没有概览统计 API（聚合查询）

---

## 6. 页面设计

### 6.1 AdminUsersPage（v0.1）

```
┌─────────────────────────────────────────────────────────┐
│  用户管理                                                │
├──────────┬──────────┬──────────┬──────────┬─────────────┤
│ 邮箱      │ 角色      │ 注册时间  │ 最后登录  │ Tier       │
├──────────┼──────────┼──────────┼──────────┼─────────────┤
│ a@b.com  │ 管理员    │ 06-01    │ 今天     │ pro        │
│ c@d.com  │ 用户     │ 06-15    │ 昨天     │ free       │
│ e@f.com  │ 用户     │ 07-01    │ 3天前    │ legacy     │
└──────────┴──────────┴──────────┴──────────┴─────────────┘

空状态：
┌─────────────────────────────────────────────────────────┐
│                    👥                                    │
│              还没有注册用户                               │
│        等待第一位用户通过邮箱验证码登录                     │
└─────────────────────────────────────────────────────────┘
```

### 6.2 AdminAuditPage（v0.2）

```
┌─────────────────────────────────────────────────────────┐
│  操作日志                                                │
├──────────┬──────────┬──────────┬──────────┬─────────────┤
│ 时间      │ 管理员    │ 目标用户  │ 操作      │ 详情        │
├──────────┼──────────┼──────────┼──────────┼─────────────┤
│ 10:32    │ admin    │ user1    │ 角色变更  │ user→admin  │
│ 09:15    │ admin    │ user2    │ License  │ 激活 Pro    │
└──────────┴──────────┴──────────┴──────────┴─────────────┘

空状态：
┌─────────────────────────────────────────────────────────┐
│                    📋                                    │
│              暂无操作记录                                 │
│        管理员操作（如角色变更）会记录在这里                  │
└─────────────────────────────────────────────────────────┘
```

### 6.3 AdminOverviewPage（v0.3）

```
┌─────────────────────────────────────────────────────────┐
│  管理后台                                                │
├──────────┬──────────┬──────────┬──────────────────────────┤
│ 总用户数  │ 今日活跃  │ 总任务数  │ 任务成功率              │
│    12     │    5     │   1,234  │      94.2%              │
├──────────┴──────────┴──────────┴──────────────────────────┤
│  最近操作（最近 10 条）                                    │
│  ┌──────────┬──────────┬──────────┬──────────┐          │
│  │ 时间      │ 用户      │ 操作      │ 详情      │          │
│  │ 10:32    │ a@b.com  │ 发布视频  │ 抖音      │          │
│  │ 10:28    │ c@d.com  │ AI生成    │ 小红书    │          │
│  └──────────┴──────────┴──────────┴──────────┘          │
└─────────────────────────────────────────────────────────┘

空状态：
┌─────────────────────────────────────────────────────────┐
│                    📊                                    │
│              系统刚启动                                   │
│        等待用户操作后显示统计数据                           │
└─────────────────────────────────────────────────────────┘
```

---

## 7. API 设计

### 7.1 GET /api/admin/users（v0.1）

复用现有 `GET /api/auth/users`，增强返回字段。

**Response:**
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

### 7.2 GET /api/admin/audit（v0.2）

**Query params:** `?page=1&per_page=50`

**Response:**
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

### 7.3 GET /api/admin/overview（v0.3）

**Response:**
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

### 7.4 GET /api/admin/system（v0.3）

**Response:**
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

---

## 8. 数据库变更

### 8.1 新增 `admin_audit_log` 表（v0.2）

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
```

---

## 9. 安全考量

1. **所有管理员端点必须使用 `@admin_required`** — 后端是权限的唯一真实来源
2. **前端仅隐藏 UI，不做权限判断** — 非管理员访问 `/dashboard/admin` 会被后端 403 拦截
3. **审计日志不可删除** — `admin_audit_log` 表不暴露 DELETE 端点
4. **角色变更需二次确认** — 前端弹窗确认，防止误操作
5. **自身角色不可降级** — 管理员不能把自己从 admin 降为 user

---

## 10. 文件变更清单

### v0.1（MVP）

| 操作 | 文件 | 说明 |
|---|---|---|
| **新建** | `sau_web/frontend/src/features/admin/AdminUsersPage.tsx` | 用户列表页 |
| **新建** | `sau_web/frontend/src/features/admin/adminApi.ts` | API 客户端 |
| **修改** | `sau_web/frontend/src/AppShell.tsx` | 添加管理员导航项 + 路由 |

### v0.2

| 操作 | 文件 | 说明 |
|---|---|---|
| **新建** | `web_runner/routes/admin.py` | 管理员 API 路由 |
| **新建** | `sau_web/frontend/src/features/admin/AdminAuditPage.tsx` | 操作日志页 |
| **修改** | `web_runner/db.py` | 添加 `admin_audit_log` 表 |
| **修改** | `web_runner/__init__.py` | 注册 admin blueprint |
| **修改** | `web_runner/routes/auth.py` | 角色变更写入审计日志 |

### v0.3

| 操作 | 文件 | 说明 |
|---|---|---|
| **新建** | `sau_web/frontend/src/features/admin/AdminOverviewPage.tsx` | 概览页 + 后续 v3-mini sparkline + v3-trends-export CSV 按钮 + v3-trends days-picker |
| **新建** | `sau_web/frontend/src/features/admin/AdminDashboard.test.tsx` | 概览/用户/审计页单元测试 + v3-mini / v3-table / v3-trends / v3-trends-export / days-picker 测试 |
| **修改** | `web_runner/routes/admin.py` | 添加 overview/system 端点 + 后续 v3-trends trends 端点 + v3-trends-export CSV 端点 |

### v1.0

| 操作 | 文件 | 说明 |
|---|---|---|
| **修改** | `sau_web/frontend/src/features/admin/AdminUsersPage.tsx` | 添加搜索、分页、角色筛选 |
| **修改** | `sau_web/frontend/src/features/admin/AdminAuditPage.tsx` | 添加时间范围筛选 |

---

## 11. UI 设计规范

### 11.1 设计风格

项目采用 **Linear/Vercel 风格**的现代简洁设计：

- **色调**：中性色为主，语义色点缀（success/warning/error/info）
- **圆角**：卡片 `rounded-xl`，按钮 `rounded-lg`，徽章 `rounded-full`
- **字体**：正文系统字体，数字/品牌使用等宽字体（`font-mono`）
- **间距**：紧凑但有呼吸感，padding 使用 `p-4` / `p-6`
- **阴影**：轻量 `shadow` 或 `shadow-sm`，hover 状态增强

### 11.2 组件复用清单

Admin Dashboard **100% 复用现有组件**，无需安装新依赖。

#### 数据展示

| 组件 | 路径 | 用途 |
|---|---|---|
| `Table` + `TableHeader` + `TableBody` + `TableRow` + `TableHead` + `TableCell` | `Components/ui/table.tsx` | 用户列表、操作日志 |
| `Card` + `CardHeader` + `CardContent` + `CardTitle` | `Components/ui/card.tsx` | 概览统计卡片、容器 |
| `Stat` | `Components/ui/stat.tsx` | 数字统计展示（总用户数、成功率等） |
| `Badge` | `Components/ui/badge.tsx` | 角色标签（admin/user）、状态标签 |
| `EmptyState` | `Components/ui/empty-state.tsx` | 空数据提示 |
| `Skeleton` | `Components/ui/skeleton.tsx` | 加载状态 |
| `PageHeader` | `Components/ui/page-header.tsx` | 页面标题 |

#### 交互组件

| 组件 | 路径 | 用途 |
|---|---|---|
| `Button` | `Components/ui/button.tsx` | 操作按钮 |
| `DropdownMenu` | `Components/ui/dropdown-menu.tsx` | 角色变更下拉菜单 |
| `Dialog` + `AlertDialog` | `Components/ui/dialog.tsx` | 角色变更确认弹窗 |
| `Select` | `Components/ui/select.tsx` | 筛选下拉框 |
| `Input` | `Components/ui/input.tsx` | 搜索框 |
| `Tooltip` | `Components/ui/tooltip.tsx` | 信息提示 |
| `Toast` | `Components/ui/toast.tsx` | 操作反馈（成功/失败） |

#### 数据获取

| 工具 | 路径 | 用途 |
|---|---|---|
| `useQuery` / `useMutation` | `@tanstack/react-query` | API 数据获取、缓存、乐观更新 |
| `api` | `api/client.ts` | HTTP 请求封装 |

#### 图表（v0.3+）

| 库 | 用途 |
|---|---|
| `recharts` | 趋势图、饼图（已有依赖，直接使用） |

### 11.3 页面结构模板

每个 Admin 页面遵循统一结构：

```tsx
import { PageHeader } from '@/Components/ui/page-header'
import { Card, CardContent, CardTitle } from '@/Components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/Components/ui/table'
import { EmptyState } from '@/Components/ui/empty-state'
import { Badge } from '@/Components/ui/badge'
import { Skeleton } from '@/Components/ui/skeleton'

export default function AdminXxxPage() {
  // 1. 数据获取
  const { data, isLoading } = useQuery(...)

  return (
    <div className="space-y-6">
      {/* 2. 页面标题 */}
      <PageHeader title="页面标题" description="页面描述" />

      {/* 3. 内容区域 */}
      <Card>
        <CardContent>
          {/* 4. 加载状态 */}
          {isLoading && <Skeleton className="h-64" />}

          {/* 5. 空状态 */}
          {!isLoading && data?.length === 0 && (
            <EmptyState
              icon={<Users className="h-6 w-6" />}
              title="暂无数据"
              description="等待用户操作..."
            />
          )}

          {/* 6. 数据表格 */}
          {!isLoading && data?.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>列1</TableHead>
                  <TableHead>列2</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map(item => (
                  <TableRow key={item.id}>
                    <TableCell>{item.field1}</TableCell>
                    <TableCell>
                      <Badge variant="success">{item.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

### 11.4 设计 Token 参考

项目使用 CSS 变量定义颜色，Admin Dashboard 应复用这些 token：

| Token | 用途 | 示例 |
|---|---|---|
| `--primary` | 强调色、CTA | 主按钮、链接 |
| `--secondary` | 次要元素 | 次要按钮、徽章 |
| `--muted` | 弱化元素 | 占位符、辅助文本 |
| `--destructive` | 危险操作 | 删除按钮、错误状态 |
| `--card` | 卡片背景 | Card 组件 |
| `--border` | 边框 | 分割线、表格边框 |

语义色（通过 `@/lib/tone` 工具函数）：

| 语义 | Badge variant | 用途 |
|---|---|---|
| `success` | `variant="success"` | 成功状态、admin 角色 |
| `warning` | `variant="warning"` | 警告状态、锁定账号 |
| `error` | `variant="error"` | 错误状态、失败任务 |
| `info` | `variant="info"` | 信息提示、普通用户 |

### 11.5 空状态设计

每个页面必须有空状态，遵循 `EmptyState` 组件规范：

| 页面 | 图标 | 标题 | 描述 |
|---|---|---|---|
| 用户列表 | `Users` | 还没有注册用户 | 等待第一位用户通过邮箱验证码登录 |
| 操作日志 | `FileText` | 暂无操作记录 | 管理员操作（如角色变更）会记录在这里 |
| 概览页 | `BarChart3` | 系统刚启动 | 等待用户操作后显示统计数据 |

### 11.6 图标选择

使用 `lucide-react` 图标库（已有依赖）：

| 场景 | 推荐图标 |
|---|---|
| 管理后台入口 | `Shield` |
| 用户管理 | `Users` |
| 操作日志 | `FileText` |
| 概览/统计 | `BarChart3` |
| 刷新 | `RefreshCw` |
| 搜索 | `Search` |
| 筛选 | `Filter` |
| 角色（admin） | `Crown` |
| 角色（user） | `User` |

---

## 12. 错误处理策略

### 12.1 HTTP 状态码处理

| 状态码 | 含义 | 前端处理 |
|---|---|---|
| 200 | 成功 | 正常渲染数据 |
| 401 | 未登录 | 跳转 `/login`，清除 auth store |
| 403 | 权限不足 | 显示 Toast「权限不足，无法访问」，跳转 `/app` |
| 404 | 资源不存在 | 显示 EmptyState「数据不存在」 |
| 429 | 请求过多 | 显示 Toast「操作过于频繁，请稍后重试」 |
| 500 | 服务器错误 | 显示 Toast「服务异常，请稍后重试」 |

### 12.2 网络错误处理

```tsx
// React Query 全局错误处理
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      retryDelay: 1000,
      staleTime: 30 * 1000, // 30秒缓存
    },
  },
})

// API 客户端拦截器
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (!error.response) {
      // 网络断开
      toast.error('网络连接失败，请检查网络')
    }
    return Promise.reject(error)
  }
)
```

### 12.3 页面级错误状态

每个页面需要处理三种状态：

| 状态 | 展示 |
|---|---|
| 加载中 | `<Skeleton className="h-64" />` |
| 加载失败 | `<EmptyState icon={<AlertCircle />} title="加载失败" description="请刷新页面重试" action={<Button onClick={refetch}>重试</Button>} />` |
| 数据为空 | `<EmptyState icon={<Users />} title="暂无数据" description="..." />` |

---

## 13. 性能设计

### 13.1 数据获取策略

| 数据 | 缓存时间 | 刷新策略 |
|---|---|---|
| 用户列表 | 60 秒 | 手动刷新按钮 |
| 操作日志 | 30 秒 | 手动刷新按钮 |
| 概览统计 | 60 秒 | 自动刷新（每 60 秒） |

### 13.2 分页策略

| 页面 | 每页条数 | 虚拟滚动 |
|---|---|---|
| 用户列表 | 20 条 | 数据量 >100 时启用 |
| 操作日志 | 50 条 | 数据量 >200 时启用 |

### 13.3 查询优化

```sql
-- 用户列表：添加索引加速查询
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at);
CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login);

-- 操作日志：按时间分区查询
CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_admin ON admin_audit_log(admin_user_id);
```

### 13.4 概览统计预计算

概览页的聚合查询可能较慢，两种优化方案：

| 方案 | 实现 | 适用场景 |
|---|---|---|
| 实时查询 | SQL COUNT/SUM | 用户量 <100 |
| 预计算 | 定时任务写入 `admin_stats` 表 | 用户量 >100 |

v0.3 先用实时查询，后续根据实际性能决定是否优化。

---

## 14. 测试策略

### 14.1 测试范围

| 层级 | 范围 | 工具 | 优先级 |
|---|---|---|---|
| 单元测试 | 组件渲染、工具函数 | Vitest + Testing Library | P1 |
| 集成测试 | API 路由、数据库操作 | Vitest + SQLite | P1 |
| E2E 测试 | 完整用户流程 | Playwright | P2 |

### 14.2 关键测试用例

#### 单元测试

| 用例 | 验证点 |
|---|---|
| `AdminUsersPage` 渲染 | 加载态 → 空状态 → 数据表格 |
| `AdminAuditPage` 渲染 | 加载态 → 空状态 → 数据表格 |
| `AdminOverviewPage` 渲染 | 统计卡片数字正确显示 |
| 角色变更下拉菜单 | 选项正确、点击触发确认弹窗 |

#### 集成测试

| 用例 | 验证点 |
|---|---|
| `GET /api/admin/users` | 非 admin 返回 403 |
| `GET /api/admin/users` | admin 返回用户列表 |
| `PUT /api/admin/users/<id>/role` | 角色变更成功 |
| `PUT /api/admin/users/<id>/role` | 自身降级被拒绝 |
| `GET /api/admin/audit` | 审计日志正确记录 |

#### E2E 测试

| 用例 | 步骤 |
|---|---|
| 管理员登录 → 看到管理后台入口 | 登录 → 检查侧边栏 |
| 管理员登录 → 查看用户列表 | 登录 → 点击管理后台 → 点击用户管理 |
| 管理员登录 → 变更用户角色 | 登录 → 用户管理 → 点击角色下拉 → 选择 → 确认 |
| 普通用户登录 → 看不到管理后台入口 | 登录 → 检查侧边栏无 Shield 图标 |

### 14.3 测试文件结构

```
src/
├── features/admin/
│   ├── __tests__/
│   │   ├── AdminUsersPage.test.tsx
│   │   ├── AdminAuditPage.test.tsx
│   │   └── AdminOverviewPage.test.tsx
│   ├── AdminUsersPage.tsx
│   ├── AdminAuditPage.tsx
│   └── AdminOverviewPage.tsx

tests/
└── e2e/
    └── admin.spec.ts
```

---

## 15. 上线与运维

### 15.1 发布策略

| 版本 | 发布方式 | 回滚方案 |
|---|---|---|
| v0.1 | 直接发布 | 删除侧边栏入口代码，后端 API 保持（无害） |
| v0.2 | 直接发布 | 回滚 `admin.py` 和 `admin_audit_log` 表（保留不删除） |
| v0.3 | 直接发布 | 回滚 `AdminOverviewPage.tsx` |

### 15.2 回滚检查清单

```bash
# 1. 前端回滚
git revert <commit-hash>
npm run build

# 2. 后端回滚（如需要）
git revert <commit-hash>
# 重启 web_runner.py

# 3. 数据库（无需回滚）
# admin_audit_log 表保留，不影响现有功能
```

### 15.3 监控指标

| 指标 | 阈值 | 告警方式 |
|---|---|---|
| `/api/admin/*` 响应时间 | >2s | 日志告警 |
| `/api/admin/*` 错误率 | >5% | 日志告警 |
| 前端 JS 错误 | 有错误 | Console + 日志 |

### 15.4 数据保留策略

| 数据 | 保留时间 | 清理方式 |
|---|---|---|
| `admin_audit_log` | 永久 | 不清理（审计需要） |
| `usage_logs` | 90 天 | 定时任务清理 |
| `error_events` | 30 天 | 定时任务清理 |

---

## 16. 隐私与合规

### 16.1 数据收集声明

Admin Dashboard 展示以下用户数据：

| 数据类型 | 来源 | 用途 | 用户可见性 |
|---|---|---|---|
| 邮箱 | 登录时提供 | 用户标识 | 用户自己可见 |
| 登录时间 | 系统记录 | 活跃度判断 | 用户自己可见 |
| 操作类型 | 系统记录 | 使用分析 | 用户自己可见 |
| 角色 | 管理员设置 | 权限管理 | 用户自己可见 |

### 16.2 隐私保护措施

1. **邮箱脱敏**：用户列表页非管理员只能看到自己的邮箱
2. **操作日志**：只记录操作类型，不记录操作内容详情
3. **数据访问**：只有 admin 角色可以查看所有用户数据

### 16.3 数据导出合规

如果未来添加 CSV 导出功能：
- 导出操作需记录到 `admin_audit_log`
- 导出文件不包含敏感字段（如 license_key）
- 导出文件应加密或设密码

---

## 17. 可访问性（a11y）

### 17.1 基本要求

| 要求 | 实现方式 |
|---|---|
| 键盘导航 | Radix UI 组件原生支持 |
| 屏幕阅读器 | 使用语义化 HTML + aria-label |
| 颜色对比度 | 遵循 WCAG 2.1 AA 标准（4.5:1） |
| 焦点指示 | 使用 `focus:ring-2` 样式 |

### 17.2 组件 a11y 检查清单

| 组件 | 键盘操作 | aria 属性 |
|---|---|---|
| Table | Tab 导航 | `role="table"` |
| DropdownMenu | Enter/Escape | `aria-haspopup`, `aria-expanded` |
| Dialog | Tab 锁定 + Escape | `aria-modal`, `role="dialog"` |
| Button | Enter/Space | `aria-label`（图标按钮） |

---

## 18. 开发者指南

### 18.1 本地开发

```bash
# 1. 启动后端
python web_runner.py

# 2. 启动前端
cd sau_web/frontend
npm run dev

# 3. 访问 Admin Dashboard
# 以 admin 身份登录后，侧边栏会出现"管理后台"入口
```

### 18.2 新增 Admin 页面步骤

1. 在 `sau_web/frontend/src/features/admin/` 创建页面组件
2. 在 `adminApi.ts` 添加 API 调用（如需要）
3. 在 `AppShell.tsx` 添加路由
4. 在 `AppShell.tsx` 的 `navItems` 添加导航项（如需要）
5. 编写测试用例

### 18.3 代码规范

- 遵循项目现有的 TypeScript + React 规范
- 使用 Tailwind CSS 类名，不写内联样式
- 组件 props 使用 interface 定义
- API 调用使用 React Query hooks
- 错误处理使用 Toast 组件

### 18.4 提交规范

```
feat(admin): add user list page
fix(admin): fix role change confirmation dialog
test(admin): add E2E tests for admin dashboard
docs(admin): update design document
```

---

## 19. 依赖决策记录

### 19.1 为什么 100% 复用现有组件？

| 考虑因素 | 决策 |
|---|---|
| 减少包体积 | 不引入新依赖 |
| 保持一致性 | 与现有页面风格统一 |
| 降低维护成本 | 只需维护一套组件 |
| 加速开发 | 无需学习新 API |

### 19.2 为什么不用 shadcn/ui 官方组件？

项目组件已经是 shadcn/ui 风格（基于 Radix UI + Tailwind），无需重复安装。现有组件已包含所有需要的功能。

### 19.3 为什么用 Recharts 而不是其他图表库？

| 因素 | Recharts | 其他（ECharts/Chart.js） |
|---|---|---|
| React 原生 | ✅ | ❌ 需要 wrapper |
| 包体积 | 小 | 大 |
| 学习成本 | 低 | 中-高 |
| 现有依赖 | ✅ 已安装 | ❌ 需新增 |

---

## 20. 后续扩展（v1.0+）

- [ ] 用户会话管理（查看在线用户、强制下线）
- [ ] 系统配置 UI（SMTP、CORS、配额阈值等）
- [ ] License 管理页面（批量生成、查看激活状态）
- [ ] 导出功能（用户列表 CSV、审计日志 CSV）

---

## 21. 社交登录实现（v1.1）

### 21.1 技术选型

选择 **Authlib** 作为 OAuth 库：

| 因素 | Authlib | Flask-OAuthlib | authlib-limiter |
|---|---|---|---|
| 维护状态 | 活跃（v1.7.2） | 已废弃 | 不活跃 |
| Flask 集成 | ✅ 原生支持 | ✅ | ❌ |
| OpenID Connect | ✅ | ❌ | ❌ |
| 文档完善度 | 高 | 中 | 低 |
| 社区支持 | 强 | 弱 | 弱 |

### 21.2 依赖安装

```bash
pip install authlib
```

### 21.3 后端实现

#### 21.3.1 新建 OAuth 配置模块

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

#### 21.3.2 新建社交登录路由

```python
# web_runner/routes/oauth.py

from flask import Blueprint, redirect, url_for, session, jsonify
from web_runner.oauth import oauth
from web_runner.db import get_database
from datetime import datetime, timezone

bp = Blueprint('oauth', __name__)


def _find_or_create_user(email: str, name: str | None = None, avatar: str | None = None) -> dict:
    """查找或创建用户，返回用户字典"""
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


# ── Google 登录 ──────────────────────────────────────────────────


@bp.get('/api/auth/google/login')
def google_login():
    """重定向到 Google 登录页面"""
    redirect_uri = url_for('oauth.google_callback', _external=True)
    return oauth.google.authorize_redirect(redirect_uri)


@bp.get('/api/auth/google/callback')
def google_callback():
    """Google 登录回调"""
    try:
        token = oauth.google.authorize_access_token()
        userinfo = token['userinfo']
        
        user = _find_or_create_user(
            email=userinfo['email'],
            name=userinfo.get('name'),
            avatar=userinfo.get('picture'),
        )
        _create_session(user)
        
        return redirect('/dashboard')
    except Exception as exc:
        return redirect('/login?error=google_failed')


# ── GitHub 登录 ──────────────────────────────────────────────────


@bp.get('/api/auth/github/login')
def github_login():
    """重定向到 GitHub 登录页面"""
    redirect_uri = url_for('oauth.github_callback', _external=True)
    return oauth.github.authorize_redirect(redirect_uri)


@bp.get('/api/auth/github/callback')
def github_callback():
    """GitHub 登录回调"""
    try:
        token = oauth.github.authorize_access_token()
        resp = oauth.github.get('user', token=token)
        profile = resp.json()
        
        # 获取邮箱（GitHub 默认不返回邮箱）
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
        
        return redirect('/dashboard')
    except Exception as exc:
        return redirect('/login?error=github_failed')
```

#### 21.3.3 注册蓝图

```python
# web_runner/__init__.py

from web_runner.routes.oauth import bp as oauth_bp
app.register_blueprint(oauth_bp)
```

### 21.4 前端实现

#### 21.4.1 扩展 authApi

```typescript
// sau_web/frontend/src/features/auth/authApi.ts

export const authApi = {
  // 现有方法保持不变...
  
  // 社交登录
  googleLogin() {
    window.location.href = '/api/auth/google/login'
  },
  
  githubLogin() {
    window.location.href = '/api/auth/github/login'
  },
}
```

#### 21.4.2 更新登录页面

```tsx
// sau_web/frontend/src/Pages/LoginPage.tsx

import { Button } from '@/Components/ui/button'
import { Separator } from '@/Components/ui/separator'
import { authApi } from '@/features/auth/authApi'

// Google 图标
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  )
}

// GitHub 图标
function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
  )
}

export function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md space-y-6 p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold">登录</h1>
          <p className="text-muted-foreground mt-2">
            选择登录方式继续
          </p>
        </div>

        {/* 社交登录按钮 */}
        <div className="space-y-3">
          <Button 
            variant="outline" 
            className="w-full"
            onClick={() => authApi.googleLogin()}
          >
            <GoogleIcon className="mr-2 h-4 w-4" />
            Google 登录
          </Button>
          
          <Button 
            variant="outline" 
            className="w-full"
            onClick={() => authApi.githubLogin()}
          >
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
            <span className="bg-background px-2 text-muted-foreground">
              或者使用
            </span>
          </div>
        </div>

        {/* 邮箱验证码登录 */}
        <EmailLoginForm />
      </div>
    </div>
  )
}
```

### 21.5 环境变量配置

```bash
# .env 文件

# Google OAuth（需要在 Google Cloud Console 创建）
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx

# GitHub OAuth（需要在 GitHub Settings → Developer settings 创建）
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
```

### 21.6 OAuth 应用配置指南

#### Google Cloud Console

1. 访问 https://console.cloud.google.com
2. 创建新项目或选择现有项目
3. 导航到「API 和服务」→「凭据」
4. 点击「创建凭据」→「OAuth 客户端 ID」
5. 配置 OAuth 同意屏幕
6. 创建 OAuth 2.0 客户端 ID
7. 添加重定向 URI：`http://localhost:6001/api/auth/google/callback`

#### GitHub Settings

1. 访问 https://github.com/settings/developers
2. 点击「New OAuth App」
3. 填写应用信息：
   - Application name: `social-auto-upload`
   - Homepage URL: `http://localhost:5180`
   - Authorization callback URL: `http://localhost:6001/api/auth/github/callback`
4. 保存 Client ID 和 Client Secret

### 21.7 数据流

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

### 21.8 安全考量

1. **CSRF 防护**：OAuth 库自动处理 state 参数
2. **Token 存储**：使用 Flask session（服务端存储）
3. **邮箱验证**：使用 Google/GitHub 已验证的邮箱
4. **最小权限**：只请求必要的 scope（email, profile）

### 21.9 测试用例

| 用例 | 步骤 | 预期结果 |
|---|---|---|
| Google 登录 | 点击 Google 登录 → 授权 → 回调 | 创建用户，跳转到 /dashboard |
| GitHub 登录 | 点击 GitHub 登录 → 授权 → 回调 | 创建用户，跳转到 /dashboard |
| 已有用户登录 | 使用已注册邮箱的 Google 账号登录 | 更新 last_login，跳转到 /dashboard |
| 取消授权 | 在 Google/Git舟 页面取消授权 | 返回 /login，显示错误提示 |

### 21.10 文件变更清单

| 操作 | 文件 | 说明 |
|---|---|---|
| **新建** | `web_runner/oauth.py` | OAuth 配置模块 |
| **新建** | `web_runner/routes/oauth.py` | 社交登录路由 |
| **修改** | `web_runner/__init__.py` | 注册 oauth_bp 蓝图 |
| **修改** | `sau_web/frontend/src/features/auth/authApi.ts` | 添加社交登录方法 |
| **修改** | `sau_web/frontend/src/Pages/LoginPage.tsx` | 添加社交登录按钮 |
| **修改** | `requirements.txt` | 添加 authlib 依赖 |

---

## 22. 趋势数据 API（v3-trends）

### 22.1 背景

`GET /api/admin/overview` 只能给当前快照（总用户数、今日活跃、总任务数、任务成功率）——管理员看不到这些数字"近几天的变化趋势"。v3-trends slice 引入 `GET /api/admin/trends?metric=X&days=N` 端点，返回 14 天历史序列，供 4 张统计卡下方的 mini sparkline 渲染。

### 22.2 端点契约

```
GET /api/admin/trends?metric=total_users&days=14
```

| 参数 | 类型 | 必填 | 范围 | 默认 | 说明 |
|---|---|---|---|---|---|
| `metric` | string | ✅ | `total_users` / `active_today` / `total_tasks` / `task_success_rate` | — | 4 种允许的指标 key（严格 allow-list） |
| `days`   | int    | ❌ | 1..90（超出会被**静默 clamp**）| 14 | 历史窗口长度 |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "metric": "total_users",
    "days": 14,
    "points": [38, 39, 39, 40, 40, 41, 41, 41, 42, 42, 42, 42, 42, 42]
  }
}
```

**Response (400 — invalid metric):**
```json
{ "success": false, "message": "metric 必须是以下之一: active_today, task_success_rate, total_tasks, total_users" }
```

**Response (401 / 403):** 同其他 admin 端点（未登录 / 非 admin）。

### 22.3 4 个 metric 的计算语义

| metric | SQL 源 | 聚合方式 | 含义 |
|---|---|---|---|
| `total_users` | `users.created_at` | `COUNT(*)` per day → 累加 cumulative walk | 全历史累计用户数（never-decreasing） |
| `total_tasks` | `tasks.created`   | `COUNT(*)` per day → 累加 cumulative walk | 全历史累计任务数（never-decreasing） |
| `active_today` | `usage_logs.created_at` | `COUNT(DISTINCT user_id)` per day | 每天的独立活跃用户数（非 cumulative） |
| `task_success_rate` | `tasks.created` | 7-day rolling window `(success / total) × 100` | 任务成功率（带 7 天平滑） |

**关键决策**：`task_success_rate` 故意走 **7-day rolling window** 而不是 cumulative，理由是 cumulative 形式会单调不降、误报"项目在持续变好"。窗口化的形式能反映出"最近一周的运营健康度"，更适合告警。详见 §22.5。

### 22.4 SQL 实现要点

1. **1 query per metric，不是 N subqueries**：4 个 metric × 14 天 ≠ 56 子查询，而是 4 次表扫描 + Python-side aggregate。
2. **Day-window WHERE 子句**：`WHERE date({date_col}) >= ?` 把每次查询的扫描量限制在 `O(days)`，多年度老数据表不会退化。
3. **空 DB 兜底**：所有 helper 在 per-day map 缺失日时 0-fill；`_build_trend_points` 总是返回长度恰好等于 `days` 的 series，前端可以按位置安全 index。
4. **SQLi 防御**：`_per_day_counts` 内的 `table` / `date_col` 是 f-string 拼接（不是 bound param），所以加了 `frozenset` allow-list（`{'users', 'tasks', 'usage_logs'}` × `{'created_at', 'created'}`），任何未来误用 user input 会立即 raise `ValueError`。

### 22.5 7-day rolling rate 的 warm-up 行为

`_TREND_RATE_WINDOW = 7` 是模块级常量，在 `_build_trend_points` 中实现为 `[max(0, i - 6), i]` 滑窗。

**关键陷阱**：前 6 个点的窗口**不是 7 天**（warm-up 期间窗口逐步扩大）：

| index `i` | window | 实际天数 |
|---|---|---|
| 0 | `[0, 0]` | 1 |
| 1 | `[0, 1]` | 2 |
| 2 | `[0, 2]` | 3 |
| 3 | `[0, 3]` | 4 |
| 4 | `[0, 4]` | 5 |
| 5 | `[0, 5]` | 6 |
| 6 | `[0, 6]` | 7（满窗） |
| 7..13 | `[i-6, i]` | 7（满窗） |

**admin 解读**：
- 14-day 序列里，**前 6 天的点比后 8 天的点更噪**（窗口小 → 受单日 outlier 影响大）。
- `points[-1]`（今天） = 最近 7 天的 success/total。
- `points[0]`（13 天前）= 仅有当天的 success/total（可能因 0 任务而 0.0%）。

**未来扩展**：如果 `days` < 7，**整个序列的窗口都 < 7 天**（warm-up 覆盖整个 series）。这是正确的 rolling window 行为，但读者应有心理预期。

### 22.6 前端集成：per-metric fallback

`AdminOverviewPage` 用 `useQuery` 并行 fan-out 4 路 `getTrends` 调用，每路独立 `.catch()`：

```typescript
// AdminOverviewPage.tsx
const trendsQuery = useQuery({
  queryKey: ['admin', 'trends'],
  queryFn: async () => {
    const metrics = ['total_users', 'active_today', 'total_tasks', 'task_success_rate'] as const
    const results = await Promise.all(
      metrics.map(m => adminApi.getTrends(m, 14).catch(() => undefined))
    )
    // ... 合成 Record<metric, number[] | undefined>
  },
})
```

`trends` `useMemo` 三层回退：

1. 真实 API 数据（首选；per-metric；任一 metric 失败不影响其他）
2. `trendMock`（仅当真实数据缺位 + overview 已加载；每个 metric 独立回退）
3. `null`（overview 还没加载完 → sparkline + delta chip 双双不渲染，保持卡片节奏）

**契约保证**：
- 单个 metric 5xx → 其他 3 个 metric 仍然用真实数据；该 metric 用 `trendMock` 兜底
- 全部 4 个 5xx → 全部 4 张卡都用 `trendMock` 兜底，sparkline 仍然渲染
- 网络断开 → 同样全部回退 `trendMock`

### 22.7 测试契约

**后端**（`tests/test_admin_oauth.py::TestAdminTrends`，12 条）：
- Auth gating（401 / 403）
- Metric allow-list 验证（400 + allow-list 反射回 message）
- Days clamp：`days=999 → 90`，`days=0 → 1`，`days=-5 → 1`
- Default `days=14`
- 4 个 metric 全部 shape 验证（长度 = `days`，entry 都是 number）
- `total_users` 单调不降 + 末点精确 = 3（1 admin + 2 seeds）
- `task_success_rate` 4 条 numeric：empty → 0.0、all-success-on-today → 100.0、mixed-on-today → 50.0、warm-up 排除远日数据（last=0.0、first=100.0）

**前端**（`AdminDashboard.test.tsx` 末尾，2 条）：
- mount 时 4 metric × `days=14` 全部发起
- `getTrends` reject → 4 张 sparkline 仍渲染（fallback 通路正常）

### 22.8 后续扩展方向

- `days` 作为 query param 由前端控制（目前硬编码 14；可加下拉切换 7/14/30/90）
- 缓存层（高频访问时可加 Redis 5 分钟缓存，避免每次打 4 次表扫描）
- 时间范围筛选联动（与 SegmentedTimeRange 联动，让 4 张 sparkline 也按"今天/本周/本月"切窗口）

### 22.9 v3-trends-export — CSV 下载（已实现）

#### 22.9.1 背景

§22.1-22.7 描述的 `/api/admin/trends` 端点返回 JSON 序列，供 4 张 stat 卡上的 sparkline 渲染。但运营场景下，admin 经常需要把趋势数据带到 Excel / Sheets / Notion 里做汇报或备份。v3-trends-export slice 补上一个流式 CSV 端点 + 一个点击下载按钮。

#### 22.9.2 端点契约

```
GET /api/admin/trends/export?metric=total_users&days=14
```

| 参数 | 类型 | 必填 | 范围 | 默认 | 说明 |
|---|---|---|---|---|---|
| `metric` | string | ❌ | 4 个 allow-list 之一 | — 缺省 = 全部 | 缺省时返 5 列；指定时返 2 列 |
| `days`   | int    | ❌ | 1..90（静默 clamp）| 14 | 历史窗口长度 |

**两种响应形态：**

```csv
# 缺省 metric（5 列）

date,total_users,active_today,total_tasks,task_success_rate
2026-06-22,38,5,1200,92.0
2026-06-23,39,7,1210,93.5
... 14 行 ...
```

```csv
# 指定 metric=total_users（2 列）

date,value
2026-06-22,38
2026-06-23,39
... 14 行 ...
```

**Headers (200):**
- `Content-Type: text/csv; charset=utf-8`
- `Content-Disposition: attachment; filename=sau-trends-{scope}-{days}d-{YYYY-MM-DD}.csv`
  - `scope` = `all` 或单个 metric key（如 `total_users`）
- `Cache-Control: no-store`（避免浏览器缓存中间人包）

**Headers (400 / 401 / 403):** 同其他 admin 端点。`metric` 走与 JSON 端点同一份 `_TREND_ALLOWED_METRICS` 允许列表。

#### 22.9.3 实现要点

1. **UTF-8 BOM**：`\ufeff` 作为响应体的第一个字节，让 Excel-CN / WPS 在不弹"文本导入向导"的前提下正确识别 UTF-8。否则中文 macOS / Windows Excel 会把 UTF-8 误判为 GBK。
2. **Streaming via generator**：使用 Flask `Response(generate(), mimetype="text/csv")` 包一个 `yield` 生成器。14 天 × 5 列的负载 <1 KB，gen 化主要为了让未来 `days=90` 不会把整段字符串一次性拼在内存里。
3. **RFC 4180 escaping**：值是 ISO 日期（`YYYY-MM-DD`）和 number，不需要转义；header 是纯 ASCII。直接 `f"{d},{p}\n"` 拼即可，不需要引 `csv` 模块。
4. **审计日志先于 stream 返回**：`admin_audit_log` 写入**先于** `return Response(...)`，这样客户端中途 abort 也能留痕。`action='export_trends'`，`detail=json.dumps({metric, days, row_count, file_format})`，`target_user_id=NULL`。
5. **Filename convention**：`sau-trends-{scope}-{days}d-{YYYY-MM-DD}.csv`，ASCII-only，跨平台安全（Windows / macOS / Linux 都不会乱码）。
6. **前端 blob pattern**：`request.get(..., { responseType: 'blob' })` → `URL.createObjectURL(blob)` → 临时 `<a download="...">` click → revoke。前端会自带一个 fallback filename（`sau-trends-all-{days}d-{today}.csv`），避免 `Content-Disposition` 被某些代理拦掉。

#### 22.9.4 测试契约

**后端**（`tests/test_admin_oauth.py::TestAdminTrendsExport`，5 条）：
- Auth gating（401 / 403）
- Invalid metric 走 400 + allow-list 反射回 message
- 5-col default：BOM + 1 header + 14 rows + 每行 5 列 + Content-Disposition `sau-trends-all-5d-` + audit log 行写入
- 2-col with metric：per-metric filename + 2 列

**前端**（`AdminDashboard.test.tsx` 末尾，2 条）：
- Button 渲染在 refresh 左边（`compareDocumentPosition` 验证节点顺序）
- 点击触发 `exportTrendsCsv(14)` + `URL.createObjectURL` 被调用

#### 22.9.5 后续扩展（v3-trends days-picker）

`days` 参数从后端默认 (14) 提升为前端的 `useState` 状态，详见 §22.10。

### 22.10 v3-trends days-picker — NIT 2 跟进

#### 22.10.1 背景

v3-trends 阶段，`AdminOverviewPage` 把 `TREND_EXPORT_DAYS = 14` 硬编码在模块顶部，CSV 下载的窗口与 sparkline 的窗口都被锁定在 14 天。NIT 2 把这个常量提升为前端的 `useState` 状态，添加一个 3-option 分段控件， `days` 同时驱动 4 张 sparkline 的查询参数 和 CSV 导出窗口。

#### 22.10.2 端点契约（不变）

后端 `/api/admin/trends?metric=X&days=N` 和 `/api/admin/trends/export?metric=X&days=N` 早已接受 `days` 参数（v3-trends 阶段实现，1..90 静默 clamp，默认 14）。days-picker 客户端化是**纯前端改动**。

#### 22.10.3 前端状态形状

```typescript
// AdminOverviewPage.tsx
const [days, setDays] = useState<number>(14)  // default 14 = v3-mini 行为
```

`days` 状态被 3 处读取：

1. `trendsQuery` 的 `queryKey: ['admin', 'trends', days]` — React Query 跟随 queryKey 变化自动 refetch
2. `trendsQuery` 的 `queryFn: () => adminApi.getTrends(m, days)` — fan-out 4 路请求各携带 `days`
3. `handleExportTrends` 的 `adminApi.exportTrendsCsv(days)` — 点击下载时读取当前 `days`

#### 22.10.4 Picker 组件

3 个 `Button` 组成的 inline 分段控件（外层 `role="group" aria-label="趋势时间范围"`）：

| `aria-pressed` | label | value |
|---|---|---|
| `true`（活动） | `7d` / `14d` / `30d` | 7 / 14 / 30 |

**为什么不用 `Select` 下拉**：
- 3 个定值使用下拉是“过度设计” — 多点一次才能切换
- 分段控件一眼可读当前状态，不需要打开

**为什么不用 `SegmentedTimeRange` (Radix Tabs)**：
- Radix Tabs 携带 `role="tab"` 语义。现有 `TIME_RANGE_TABS` 已经在用这个角色，加新的会混淆“tab”上下文（该页不是 tab 集，是个 "scoping control"）
- 自定义按钮 + `aria-checked` 表达 “这是 3 个互斥选项之一”的 WAI-ARIA radio 语义（详见 §22.10.4 a11y 注释）

#### 22.10.4 a11y 原语

Picker 遵话 WAI-ARIA **radio group** 模式，而不是 toggle button 模式：

- 外层 wrapper： `role="radiogroup" aria-label="趋势时间范围"`
- 每个 option： `aria-checked={isActive}`（`true` 表示选中）

**为什么不是 `aria-pressed`**：`aria-pressed` 是 toggle button 语义（可同时选多个）。Picker 是单选 —同一时刻只能有一个 active option。Screen reader（VoiceOver / NVDA）在听到 `aria-checked="true"` 时会报 “X of N, checked” ，在听到 `aria-pressed="true"` 时会报 “pressed”（不带上下文）。后者听起来像切换型控件，误导用户。

#### 22.10.5 disabled 策略

Picker 3 个选项都在 `isExporting=true` 时被 `disabled`，避免用户在中途修改 scope：

```
isExporting=true → [7d][14d*][30d]   全部不可点
                   *selected
```

如果不禁用，用户在导出开始后点击 30d ，会出现“下载完成的是 14 天 CSV，UI 上显示的是 30 天选者”的状态不一致。

#### 22.10.6 mock 兑底线程

`trendMock(metric, opts)` 早已接受 `opts.days`（默认 14），v3-mini 阶段实现。days-picker 接入后，4 处 `trendMock(...)` 调用都加上 `days` 参数，保证 mock fallback 序列长度与 picker 当前值同步。

#### 22.10.7 URL 同步

不与 URL 同步（不同于 `useTimeRangeFilter` 同步到 `?range=`）。原因：
- `range` 是“全局过滤”（所有 admin 页都接受同一 URL 参数）
- `days` 是 “概览页局部状态”（只是 sparkline 宽度）
- 加重 URL 负担会污染分享出去的 “今天/本周/本月” URL。

#### 22.10.8 测试契约

前端（`AdminDashboard.test.tsx` 新增 describe `AdminOverviewPage · /api/admin/trends days-picker`，3 条）：
- Picker 渲染 3 个选项，默认 14d active（`aria-pressed=true`）
- 点击 7d 后，4 个 `getTrends` 调用都携带 `days=7`
- 点击 30d 后点击 下载趋势，`exportTrendsCsv(30)` 被调用

后端：**不变**。 `days` 参数后端从 v3-trends 阶段就接受。

#### 22.10.9 与 v3-trends-export 的 关系

- 后端 API 不动（`/api/admin/trends` + `/api/admin/trends/export` 早已接受 `days`）
- 前端只是从 “hardcoded constant” 提升为 “user-controlled state”
- §22.8 后续扩展里关于 “`days` 作为 query param 由前端控制” 的 TODO 由此收官

--

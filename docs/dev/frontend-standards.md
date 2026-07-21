---
description: sau_web/frontend 前端开发规范 — 架构、编码、测试、性能
---

# sau_web/frontend 前端开发规范

> 最后更新：2026-07-03
> 适用版本：React 19 + Vite 8 + TypeScript 6 + Tailwind 4

---

## 一、技术栈

| 层 | 选型 | 说明 |
|----|------|------|
| 框架 | React 19 | `createRoot` + `StrictMode` |
| 构建 | Vite 8 | ESM-native, HMR |
| 语言 | TypeScript 6 | `verbatimModuleSyntax` + `erasableSyntaxOnly` |
| 样式 | Tailwind CSS 4 | `@tailwindcss/vite` 插件 |
| 路由 | react-router-dom 7 | `BrowserRouter` + `lazy()` 代码分割 |
| 状态 | Zustand 5 | 轻量全局状态，配合 `persist` 中间件 |
| 数据请求 | TanStack Query 5 | 服务端状态缓存 + 轮询 |
| HTTP | axios 1.x | 拦截器 + 重试 + 401 自动跳转 |
| 动画 | motion 12 | 页面过渡 + 组件入场 |
| 图标 | lucide-react | Tree-shakeable 图标库 |
| UI 基座 | Radix UI | 无样式无障碍原语 |
| 测试 | Vitest + Testing Library | jsdom 环境 |
| E2E | Playwright | 独立配置在 `tests/` |

---

## 二、目录结构与职责

```
sau_web/frontend/src/
├── api/              # API 客户端（axios 实例 + 领域拆分）
│   ├── client.ts     #   axios 实例、拦截器、公共类型
│   ├── sse.ts        #   SSE 流式读取工具
│   ├── accounts.ts   #   账号相关 API
│   ├── publish.ts    #   上传/发布 API
│   ├── tasks.ts      #   任务 API
│   ├── ai.ts         #   AI 生成 API
│   ├── inbox.ts      #   收件箱 API
│   └── ...           #   按领域拆分
├── Components/       # 通用 UI 组件
│   ├── ui/           #   shadcn 风格原子组件（button, badge, card...）
│   ├── motion/       #   动画封装组件
│   ├── AiPanel/      #   AI 面板组件
│   └── ...           #   按功能聚合
├── features/         # 业务领域模块
│   ├── accounts/     #   账号管理
│   ├── publish/      #   发布中心（含 wizard/ 子目录）
│   ├── tasks/        #   任务列表
│   ├── auth/         #   认证
│   └── preferences/  #   偏好设置
├── hooks/            # 自定义 React Hooks
├── stores/           # Zustand 状态仓库
├── Pages/            # 路由页面组件（每个文件一个 default export）
├── lib/              # 工具函数
│   ├── utils.ts      #   cn() 等通用工具
│   ├── tone.ts       #   状态色调工具
│   └── ai/           #   AI 相关类型
├── test/             # 测试基础设施
│   ├── render-harness.tsx    # 标准测试 Provider 包装
│   ├── fixtures.ts           # 测试夹具
│   └── setup.ts              # 全局测试配置
└── assets/           # 静态资源（图片、品牌图标）
```

### 规则

- **`Components/ui/`** — 只放纯展示原子组件，无业务逻辑。`cva()` variants 必须模块内私有。
- **`features/`** — 按业务领域聚合，每个领域可包含自己的组件、hooks、类型。领域间不互相引用。
- **`Pages/`** — 每个文件一个 `export default function`，只做路由编排，业务逻辑委托给 `features/`。
- **`api/`** — 按领域拆分为多个文件，`client.ts` 只保留 axios 实例 + 拦截器。

---

## 三、编码规范

### 3.1 命名

| 类型 | 规范 | 示例 |
|------|------|------|
| 组件 | PascalCase | `PublishWizard`, `PlatformChipStrip` |
| 文件（组件） | PascalCase | `PublishWizard.tsx` |
| 文件（工具） | kebab-case | `render-harness.tsx`, `platform-chip-strip.tsx` |
| 函数/变量 | camelCase | `handleDownload`, `filteredEntries` |
| 常量 | UPPER_SNAKE | `MOBILE_BREAKPOINT`, `MAX_RETRIES` |
| 类型/接口 | PascalCase | `TaskItem`, `PublishState` |
| 枚举 | PascalCase | `WizardStep`, `Status` |
| CSS 类 | Tailwind 原子类 | 不写自定义 CSS |

### 3.2 组件规范

```tsx
// ✅ 正确：函数组件 + 命名 export
export function PlatformChipStrip({ activeKey, testId }: Props) {
  return <nav>...</nav>
}

// ✅ 正确：memo 包裹纯展示组件
export const PublishWizard = memo(function PublishWizard(props) {
  return <div>...</div>
})

// ❌ 禁止：default export 匿名组件
export default function(props) { ... }  // 不明确命名

// ❌ 禁止：组件内定义 cva variants
const buttonVariants = cva({...})  // 必须模块级
```

### 3.3 Props 规范

```tsx
// ✅ 正确：interface 定义 props，文件名级
interface PlatformChipStripProps {
  activeKey: PlatformKey | null
  testId?: string
  label?: string
}

// ✅ 正确：布尔 prop 用正语义命名
interface Props {
  isLoading: boolean    // 而非 isNotLoading
  isCollapsed: boolean  // 而非 collapsed
}
```

### 3.4 Hooks 规范

```tsx
// ✅ 正确：自定义 hook 以 use 开头
export function useTasks() { ... }
export function useTaskTableState(tasks: TaskItem[]) { ... }

// ✅ 正确：hook 只在一个文件内定义
// src/hooks/useTasks.ts — 不要跨文件拆分

// ✅ 正确：复杂页面拆分为多个 hook
// TasksPage 拆分为 useTaskTableState + useTaskMutations + useTaskHotkeys
```

### 3.5 样式规范

```tsx
// ✅ 正确：Tailwind 原子类 + cn() 合并
<div className={cn(
  "flex items-center gap-2 rounded-lg",
  isActive && "bg-primary/10",
  isCollapsed ? "w-[60px]" : "w-[260px]",
)} />

// ✅ 正确：条件样式用 && 或三元，不用 style 对象
<span className={active ? "text-foreground" : "text-muted-foreground"} />

// ❌ 禁止：内联 style（动画关键帧除外）
<div style={{ color: 'red' }}>  // 用 text-destructive 替代
```

---

## 四、状态管理规范

### 4.1 Zustand

```tsx
// ✅ 正确：类型安全的 store
interface PublishState {
  lastTaskIds: string[]
  submitSuccess: SubmitSuccessInfo | null
  setLastTaskIds: (ids: string[]) => void
}

// ✅ 正确：需要持久化时使用 persist 中间件
export const usePublishStore = create<PublishState>()(
  persist(
    (set) => ({ ... }),
    { name: 'sau-publish-store', partialize: (state) => ({ lastTaskIds: state.lastTaskIds }) },
  ),
)

// ✅ 正确：selector 精确取值，避免全量订阅
const lastTaskIds = usePublishStore((s) => s.lastTaskIds)
```

### 4.2 TanStack Query

```tsx
// ✅ 正确：按资源类型配置 staleTime
queryClient.setQueryDefaults(['accounts'], { staleTime: 60_000 })
queryClient.setQueryDefaults(['tasks'], { staleTime: 3_000 })

// ✅ 正确：hook 封装 query
export function useTasks() {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: () => api.getTasks(),
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data || data.some(t => t.status === 'running')) return 3_000
      return false
    },
  })
}
```

---

## 五、API 调用规范

### 5.1 文件组织

```typescript
// api/client.ts — 只放 axios 实例 + 拦截器
export const request: AxiosInstance = axios.create({ ... })

// api/accounts.ts — 账号相关
export const accountsApi = {
  list: (platform?: string) => request.get(...),
  delete: (platform: string, account: string) => request.post(...),
}

// api/publish.ts — 发布相关
export const publishApi = {
  uploadVideo: (payload: VideoPayload) => request.post(...),
  uploadNote: (payload: NotePayload) => request.post(...),
}
```

### 5.2 SSE 流式请求

```typescript
// ✅ 正确：使用公共 readSSEStream 工具
import { readSSEStream } from './sse'

async function generateStream(payload, callbacks) {
  await readSSEStream(`${baseURL}/api/ai/generate/stream`, payload, {
    onChunk: (content) => callbacks.onChunk(content),
    onDone: (full) => callbacks.onDone(full),
    onError: (msg) => callbacks.onError(msg),
  })
}
```

### 5.3 错误处理

```typescript
// ✅ 正确：401 自动跳转登录
request.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().clearAuth()
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// ✅ 正确：重试用 WeakMap 存计数，不污染请求头
const retryCountMap = new WeakMap<InternalAxiosRequestConfig, number>()
```

---

## 六、测试规范

### 6.1 测试文件位置

```
src/lib/**/*.test.ts        # 纯工具函数测试（无 JSX）
src/**/*.test.tsx           # 组件/hook 测试
```

### 6.2 测试基础设施

```tsx
// ✅ 正确：使用 TestProviders 包装
import { TestProviders } from '@/test/render-harness'

function renderWithProviders(ui: ReactNode) {
  return render(
    <TestProviders client={queryClient}>
      {ui}
    </TestProviders>
  )
}
```

### 6.3 测试原则

- 每个测试文件一个 `describe` 块
- 测试描述用中文，清晰表达被测行为
- mock 外部依赖（api client、auth），不 mock 内部模块
- 优先测行为（用户看到什么），不测实现细节（调了哪个函数）

```tsx
// ✅ 正确：行为测试
it('点击下载按钮后显示下载中状态', async () => {
  render(<InboxPage />)
  await user.click(screen.getByTestId('inbox-download'))
  expect(screen.getByText('下载中')).toBeInTheDocument()
})

// ❌ 避免：实现细节测试
it('调用 api.inboxDownload', async () => {
  // 不测这个——这是实现细节
})
```

---

## 七、性能规范

### 7.1 代码分割

```tsx
// ✅ 正确：页面级 lazy loading
const PublishPage = lazy(() => import('./Pages/PublishPage'))

// ✅ 正确：Suspense fallback
<Suspense fallback={<PageLoader />}>
  <PublishPage />
</Suspense>
```

### 7.2 渲染优化

```tsx
// ✅ 正确：大列表用虚拟滚动
import { useVirtualizer } from '@tanstack/react-virtual'

// ✅ 正确：useMemo / useCallback 用于引用稳定性
const filteredEntries = useMemo(
  () => entries.filter(e => e.status === filter),
  [entries, filter],
)

// ✅ 正确：zustand 精确 selector
const currentStep = usePublishWizardStore((s) => s.currentStep)
```

### 7.3 构建优化

```ts
// vite.config.ts — manualChunks 拆分 vendor
manualChunks(id: string) {
  if (id.includes('node_modules/react')) return 'vendor-react'
  if (id.includes('node_modules/motion')) return 'vendor-motion'
  if (id.includes('node_modules/@radix-ui/')) return 'vendor-radix'
  if (id.includes('node_modules/@tanstack/react-query')) return 'vendor-query'
  if (id.includes('node_modules/recharts')) return 'vendor-charts'
}
```

---

## 八、Git 提交规范

### 8.1 分支命名

```
feat/<feature-name>       # 新功能
fix/<bug-description>     # 修复
refactor/<what>           # 重构
perf/<what>               # 性能优化
chore/<what>              # 杂项
```

### 8.2 提交信息

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

示例：
```
feat(publish): 添加定时发布功能

- 新增 SchedulePicker 组件
- publishWizardStore 添加 schedule 字段
- ReviewStep 显示定时时间

Closes #123
```

### 8.3 提交前检查

- [ ] TypeScript 编译通过（`tsc -b`）
- [ ] 测试通过（`vitest run`）
- [ ] ESLint 无新增错误
- [ ] 无 `console.log` 残留
- [ ] 无未使用的 import

---

## 九、常见反模式（避坑）

| 反模式 | 正确做法 |
|--------|---------|
| 在组件文件顶部写大段历史注释 | 放 git commit message 里 |
| axios 重试计数用自定义 header | 用 `WeakMap<InternalAxiosRequestConfig, number>` |
| 5 个 SSE 方法各写一遍读取循环 | 抽取 `readSSEStream()` 公共函数 |
| 空状态只放一个图标 + 一行字 | 加 pulse 动画 + 操作引导步骤 |
| 组件内定义 `cva()` variants | 提到模块级，保持 Fast Refresh 兼容 |
| zustand store 不持久化 | 需要持久化的字段加 `persist` 中间件 |
| 测试用 happy-dom | 用 jsdom（更完整的 DOM API 支持） |
| 图片不加 `loading="lazy"` | 所有非首屏 `<img>` 加 `loading="lazy"` |

---

## 十、快速参考

```bash
# 开发
pnpm dev              # 启动 Vite 开发服务器（:5180）

# 构建
pnpm build            # tsc -b && vite build

# 测试
pnpm test             # vitest run
pnpm test:watch       # vitest watch

# 代码检查
pnpm lint             # eslint .

# E2E
pnpm e2e              # playwright test
```

---

> 📝 **维护说明：** 本文档随项目演进更新。新增技术选型、修改目录结构、调整规范时同步更新此文件。
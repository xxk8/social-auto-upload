# [Bug] AccountsProvider 18 tests fail with `state is null` after Proxy removal

**Severity**: Medium (blocks 18 tests; broad surface — every test that touches state updates through the provider)

**Labels**: `bug`, `test-only`, `orthogonal-to-router-migration`, `surface-18-tests`, `effort-2-4-lines`

---

## 🔁 复现步骤

```bash
cd sau_web/frontend
npx vitest run src/features/accounts/AccountsProvider.test.tsx
```

期望：所有 `AccountsProvider — rendering / state updates / getPlatformLabel / filter logic` + `validateGroupName` 全部通过。

实际：全部 **18 个测试 failed**，错误签名：

```
TypeError: Cannot read properties of null (reading 'state')
TypeError: Cannot read properties of null (reading 'dispatch')
```

代表性 fail 用例（来自 vitest verbose 输出）：

- `AccountsProvider — rendering › renders children without error`
- `AccountsProvider — rendering › exposes state context with default values` → `state` 读到 `null`
- `AccountsProvider — rendering › exposes server groups from useAccountGroups` → `state.groups` 读到 `null`
- `AccountsProvider — state updates › setSearchQuery updates searchQuery` → `dispatch` 读到 `null`
- `AccountsProvider — state updates › handleCreateGroup creates a group via mutation`
- `AccountsProvider — getPlatformLabel › returns Chinese label for known platforms` → first assertion on `dispatch.getPlatformLabel` 时 `dispatch` 是 `null`
- `AccountsProvider — filter logic (filteredGroups) › filters groups by name`
- `validateGroupName › accepts valid group names`

---

## 🧬 Root Cause（barrel-bypass：vitest mock 拦截未穿透 `@/api/client` 再导出）

测试侧 mock 表面（vialess-mocked 模块）：

```ts
vi.mock('@/api/types', () => ({
  PLATFORMS: [
    { label: '抖音', value: 'douyin', color: 'magenta' },
    { label: '快手', value: 'kuaishou', color: 'orange' },
    /* …7 platforms… */
  ] as const,
}))
vi.mock('@/hooks/useAccountGroups', () => ({
  useAccountGroups: () => ({ data: _currentMockData, isLoading: false, refetch: vi.fn() }),
  useCreateAccountGroup: () => ({ mutateAsync: vi.fn().mockResolvedValue({...}), isPending: false }),
  /* …8 more mutations… */
}))
```

生产侧 import（`<AccountsProvider>` 直接 `import`）：

```ts
// src/features/accounts/AccountsProvider.tsx:8
import { PLATFORMS, type AccountGroup } from '@/api/client'   // ← barrelled
```

**主要假设**（最高可能性）：vitest 的 `vi.mock('@/api/types', …)` **不会**穿透到 `@/api/client` barrel 的静态再导出。原因：vitest 的 mock 拦截是基于精确的 import specifier。生产代码通过 `@/api/client` 走 barrel，barrel 内部的 `export { PLATFORMS } from '@/api/types'` 在 vitest 模块图里会重新求解一次。**如果 barrel 是静态 ESM 再导出**（`export ... from '@/api/types'`），实测 vitest 在多数项目里 **能** 命中 leaf mock（因为 leaf 在 ESM 引用图上仍然是同一个模块 ID）；但若 barrel 是 **re-export 桥接**（barrel 自己 import 然后 export），且 barrel 文件本身没有被显式 mock，那么 barrel 解析时拿到的是 leaf 在 vi.mock 时已经被替换的 module——理论上 OK。

**次要假设**（仍待验证）：`<AccountsProvider>` 在 render 早期因为别的 import（`resolveSoftPrompt`, `Spinning`, 别的 canvas/toast component 等）抛错，导致 `<AccountsStateCtx.Provider>` 没有运行，`useAccountsState()` 命中默认 `null`。

无论哪条假设，**最重要的事实**：测试在 commit `9e3e1d79` 之前通过 setup.ts 的 `vi.mock('@/api/client', new Proxy(…))` **间接被 Proxy 兜底了**——Proxy 把 `state/dispatch` 当成 `@/api/client` 上的访问，返回 `vi.fn()`，于是即使 hooks 返回 null，`.state` 也不算真错（因为 Proxy 的 `.state` 是 `vi.fn()`，永远 truthy）。Proxy 移掉之后这个兜底没了。

> **为什么是 test-side 修复优先？**
> 同 Ticket 01/02 的 invariant：生产端已经通过 `parseOrThrow(raw, schema)` + null-safety 三层防护，运行时不可能收到 null。如果给生产加 `Array.isArray() ?? []` 兜底，会把契约隐藏在运行时分支里。

---

## 🔬 候选假设 + 验证命令（**实施 fix 前必做**）

下面 3 个假设是**并行**的（不互斥）。先依次验证 A → B → C，从中定位真正的 root cause 后，再走到修复方案。

| # | 假设 | 验证命令（加 <code>console.log</code> 后跑测试） | 期望输出 | 验证结果判定 |
|---|---|---|---|---|
| **A** | barrel-bypass：`@/api/client.PLATFORMS` 在 `AccountsProvider` render 时拿到的是 undefined / 真实 PLATFORMS （不是 mocked 的 7-array） | 在 `src/api/client.ts` 顶部加：`<br><code>console.warn('[DIAG-A] client.ts module loaded; PLATFORMS.length=', require('@/api/types').PLATFORMS?.length ?? 'undefined-from-leaf')</code>` 后跑测试 | 警告行出现，且后项 == 7 | != 7 → **A 成立** |
| **B** | TDZ / closure capture：`vi.mock('@/hooks/useAccountGroups', () => ({ useAccountGroups: () => ({ data: _currentMockData, ... }) }))` 的 factory 闭包捕获 <code>let _currentMockData</code> stale binding（在 factory 调用时 <code>_currentMockData</code> 还未赋值） | 把顶部 <code>let _currentMockData = _defaultGroups</code> 改为 <code>const _currentMockData = vi.hoisted(() => _defaultGroups)</code> + 测试内只通过 <code>vi.mocked(useAccountGroups).mockReturnValueOnce(...)</code> override | spy state 跟随赋值 | spy state 仍为 <code>[]</code> → **B 成立** |
| **C** | context module-ID divergence：test 侧 <code>import { AccountsStateCtx } from './AccountsProvider.helpers'</code> 与 production `<AccountsProvider>` 内部 <code>import { AccountsStateCtx } from './AccountsProvider.helpers'</code> 在 vitest 模块图上不是同一个 module 实例（导致 test 的 context provider 填的是 production ctx 的 default null） | 在 helper.ts 顶部加：<br><code>console.warn('[DIAG-C] helpers module hash =', Math.random())</code>。同一 test 内两次 import 该 helper（一次性 import + renderHook 间接 import）</br> | 同一 hash 出现 2 次 | 两个不同 hash → **C 成立** |

**实施顺序**：

1. **运行 A 后跑 `vitest run --reporter=verbose src/features/accounts/AccountsProvider.test.tsx`**（不要先改 import）。根据警告值判定 A。
2. 如果 A 不成立（PLATFORMS 是 mocked value）但 state 仍 null → 运行 B。
3. 如果 B 不成立（spy state 跟着变）但 state 仍 null → 运行 C。
4. **只有验证完三条**后，才走下面修复方案。

> **为什么是 diagnostic-first？** 因为 barrel-bypass 只在叶 mock 拦不到时才成立，而 vitest 对静态 <code>export ... from './leaf'</code> 的拦截并非 100% 确定行为。读 "诊断警告" 是唯一可靠路径。Reader 不要盲目试 fix A 再看看是否 work。

---

## 🔧 修复方案（**只有通过上面诊断后才进入**；推荐 2 选 1，先尝试 A）

### 方案 A：生产侧把 barrel import 改为 leaf import（推荐）

```diff
 // src/features/accounts/AccountsProvider.tsx:8
-import { PLATFORMS, type AccountGroup } from '@/api/client'
+import { PLATFORMS } from '@/api/types'
+import type { AccountGroup } from '@/api/types'  // type-only stays erased at runtime
```

工作量：2-4 行（按文件 grep 行号决定 import 实体 + 类型合并语法）。
改动面：仅 `AccountsProvider.tsx`，其他文件继续用 `@/api/client` 或改 leaf path 取决于现有 import overview。

### 方案 B：测试侧追加 `@/api/client` passthrough mock

```diff
 // src/features/accounts/AccountsProvider.test.tsx (在 vi.mock('@/api/types') 之后追加)
+vi.mock('@/api/client', () => ({
+  PLATFORMS: [
+    { label: '抖音', value: 'douyin', color: 'magenta' },
+    /* …same 7 lines as already mocked on '@/api/types'… */
+  ],
+  getNoteImageLimit: () => 30,
+}))
```

工作量：~10 行（重复 @/api/types 测试 mock 内容）。
缺点：与 Round-XXX 的「消灭 `@/api/client` mock 桶」目标方向相反；不推荐。

**推荐 A**（方向一致：迁移清理阶段即把 barrel→leaf 路径走通）。如果 A 仍然 18 failures，则 revert A 并切换到 B；**都不要在生产端加 null 兜底分支**。

---

## 🧪 验证

```bash
cd sau_web/frontend
npx vitest run src/features/accounts/AccountsProvider.test.tsx 2>&1 | tail -20
# 期望：failures 从 18 → 0；若方案 A 只减为 X，再用方案 B 兜底

npx tsc --noEmit --project tsconfig.app.json   # 应保持 0 errors
```

如果 18 failures 中 **仍有残余**，按 `docs/dev/jsx-testid-parsing.md` 的「在同一 useEffect 内 `console.log(apiX.mock.calls.length)`」方法定位具体失败用例，跟踪是 TDZ-`_currentMockData` 还是 `<TestProviders>` 包装问题。

---

## ⚠️ 风险面

对生产代码的影响（方案 A）：

- `AccountsProvider.tsx` 改 1-2 行 import。**生产运行时不变**：
  - `PLATFORMS` 通过 leaf 拿到的对象 vs 通过 barrel 拿到的对象 **同一个 module 实例**（如果 leaf 路径使用过），值相同。
  - `AccountGroup` 是 type-only，编译产物不包含运行时代码，无变化。

其他消费方：

- `src/features/accounts/AccountsProvider.helpers.ts` 也有 `import type { AccountGroup } from '@/api/client'`——type-only 不影响，但**统一迁移到 leaf**更干净。
- `src/hooks/useAccountGroups.ts` 同样第二行 `import { type AccountGroup } from '../api/client'`——type-only，迁移零成本。

---

---

## 🚨 实证调查记录（DIAG-A 反低明脏证据 / 后续重推步骤）

> 本节为 后续调查人 补上。**03 最初假设 "vitest mock 不穿透 barrel"，被临场诊断反驳**。下面记录原始 diag 代码 + 输出 + 推断。最后状态推到下一阶段调查。

### 步骤 1：添加临时 DIAG-A 到 `src/api/client.ts`

```ts
// 补完后已恢复原状（下面记录仅为实证调查所用）
import { PLATFORMS as _diag_a_PLATFORMS } from './types'
// eslint-disable-next-line no-console
console.warn('[DIAG-A-TEMPORARY] PLATFORMS.length=', _diag_a_PLATFORMS?.length, 'first.label=', (_diag_a_PLATFORMS as Array<{ label: string }>)?.[0]?.label)
```

### 步骤 2：跑两个 test file

```bash
cd sau_web/frontend
npx vitest run \
  src/features/accounts/AccountsProvider.test.tsx \
  src/features/publish/NoteForm.test.tsx \
  > /tmp/vitest_diag.txt 2>&1
grep '\[DIAG-' /tmp/vitest_diag.txt
```

### 步骤 3：实证输出

```
[DIAG-A-TEMPORARY] PLATFORMS.length= 2 first.label= 抖音
[DIAG-A-TEMPORARY] PLATFORMS.length= 7 first.label= 抖音
[DIAG-A-NOTE-FORM] getNoteImageLimit typeof = function
[DIAG-A-NOTE-FORM] getNoteImageLimit typeof = function
```

### 步骤 4：解读（重要）

- **leaf mock 能穿透到 barrel** 不是 barrel-bypass。`@/api/client` 里的 `export { PLATFORMS } from './types'` 相对路径与 `@/api/types` alias 在 vitest 模块图里是同一模块 ID，叶 mock 拦截成功。
- **跨文件 mock 污染**：`PLATFORMS.length` 在 `2` 与 `7` 之间跳变换，与每个 test 文件 mock 的长度相稳。表明 `@/api/types` 跨 test 文件被重复 mock 时，后面者的 mock 注册在高优先・上个 test 文件只剩空完。无方法是“受央手身型”变异。
- **不是 barrel 问题**，而是 **test isolation** 问题。需 `beforeEach(vi.unmock(...))` / `vi.resetModules()` 或重构代码使 mock 不会再重叠。

### 步骤 5：DRM 应用 B/C 诊断

A 反驳后18+8 失败的真正 Root Cause 仍未定位。后续调查人请接跑 03 §🔬 中的 **假设 B（TDZ 闭包）** 与 **假设 C（context module-ID 分岐）**。两者中 C 高度可能（是 test isolation 问题的同源表现）。

### 步骤 6：重置（diag 代码已复原）

本次调查后 `[DIAG-A-TEMPORARY]` / `[DIAG-A-NOTE-FORM]` / `_diag_a_*` 变量全部从 `src/api/client.ts` 中清理。原状为：

```ts
// ── 类型与常量 re-export — 保持现有 import 路径兼容 ────────
export { getNoteImageLimit } from './types'
export type { ... } from './types'
export { PLATFORMS, PLATFORMS_WITH_ICONS, ... } from './types'
```

### 步骤 7：记录用 grep 验证 实施人重启调查时验证

```
grep -nE '\[DIAG-|_diag_a_' src/api/client.ts
# 期望输出 = (none)
```

如果 grid 在切责中出现 _diag_a_遗留变量，则上次调查未重置干净，需手动清理。

### 步骤 8：本调查人重启调查时的入口

```
cat docs/dev/second-batch-tickets/03-accounts-provider-barrel-bypass.md
# 看 §🔬 候选假设 + 验证命令
# 跑 §🔬 中的 B 假设诊断 + C 假设诊断
# 看调查记录 · 上面 §🚨
```

---

---

## 🚨 实证调查记录（DIAG-A 反低明脏证据）

> 本节为后续调查人补上。参考 [03-*.md §🚨 实证调查记录](03-accounts-provider-barrel-bypass.md#-实证调查记录diag-a-反低明脏证据--后续重推步骤) - **DIAG-A-TEMPORARY 输出** 同样发现了跨文件 mock 污染问题：

```
[DIAG-A-TEMPORARY] PLATFORMS.length= 2 first.label= 抖音
[DIAG-A-TEMPORARY] PLATFORMS.length= 7 first.label= 抖音
[DIAG-A-NOTE-FORM] getNoteImageLimit typeof = function   ← 两边都是 function
```

### 对 NoteForm 特定的解读

- leaf mock 穿透到 barrel ✓ （ `typeof getNoteImageLimit === 'function'` 验证 ）
- 跨文件 mock 污染 同样是 NoteForm 的同源问题（同一个 `@/api/types` 在多 test 文件被重复 mock）
- 假设 A (barrel-bypass) 已反驳 反复调位在 22 个 reactive 错。`applyAiResult is null` 不是 `getNoteImageLimit` 调用失败引起的 ——`typeof getNoteImageLimit === 'function'` 该能调用。
- `applyAiResult is null` **不依赖** barrel-bypass hypothesis。这个失败可能与 03 的 18 个 failures 是**同一个问题**的不同表现——**context module-ID 分岐** (假设 C) 或 **test isolation 跨文件 mock 污染**（假设 D，新发现）。

### 后续调查入口

看 03 §🔬 候选假设 + 验证命令 + 本节实证记录。下一步推荐跑 03 §🔬 中的 **假设 C（context module-ID 分岐）**诊断，待 Test 表现同步以验证是否是同一个 module-ID 同源问题。

---

## 🔗 关联

- 起源 commit：`9e3e1d79` `chore(test): retire legacy @/api/client mock bucket`
- 同批次 ticket：[04-noteform-barrel-bypass.md](04-noteform-barrel-bypass.md)（同一 barrel-bypass 假设家族）
- 同批次 ticket：[05-useauthorizeaccountgroup-aspirational-short-circuit.md](05-useauthorizeaccountgroup-aspirational-short-circuit.md)（不同假设家族：测试侧 aspirational 测试）
- 索引：[README.md](README.md)

## 📚 复用留底（扩 Ticket 01/02）

> **barrel-bypass vitest 假设（DIAG-A 部分反低明脏证据）**：vitest 的 `vi.mock('@/api/leaf')` 对 `import … from '@/api/barrel-that-re-exports-leaf'` 的拦截行为不确定。生产代码迁移阶段应**直接 import leaf path** 才能稳定避开这个问题。Setup-time 的全局 Proxy 兜底只是临时止血，长期方向是 barrel 在生产里只剩 type-only 再导出（type-only 不运行时求值），runtime 实体走 leaf。

---

## 🎯 调查结论摘要（DIAG-A 后续调查人 一页纸快读）

**A 反驳结果**：假设 A **不成立**。用户提问中的“如果是验证为 root cause 则应用 sed” 条件不满足 → **sed 未应用**，26 failures 仍存在。

**新的发现**：跨文件 mock 污染（假设 D）。后注册 mock 赢。同一个 `@/api/types` 在多 test 文件被重复 mock 时，AccountsProvider test 看到 NoteForm 的 2-platform mock，反之反。原 Read **不该混淆**：

| 状态 | 表现 | 后续调查人动作 |
|---|---|---|
| leaf mock 穿透 barrel | **能** (DIAG-A 反低明脏) | sed 不需 用于 barrel-bypass 修复 |
| 跨文件 mock 污染 | **存在** (DIAG-A 发现) | 在 `src/test/setup.ts` 加 `vi.resetModules()` 或 per-test `beforeEach(vi.unmock('@/api/types'))` |
| 18 AccountsProvider + 8 NoteForm failures | 26 个 reactive 失败 | 仍待定位 - 走在 **假设 C (context module-ID 分岐)** 可能反低明脏 |

**sed 解冲突与 cross-test pollution 互不相关**：即使 leaf-import sed 被验证为有效 （本调查已证伪），cross-test pollution 仍需独立修复。这两个问题是 **正交的**，未来实施人不要合并。

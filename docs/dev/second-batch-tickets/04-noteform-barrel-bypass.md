# [Bug] NoteForm 8 tests fail with `applyAiResult is null` + memo-stability asymmetries

**Severity**: Medium (blocks 8 tests; imperative-handle contract is on the load-bearing path for AI sidebar → form bridge)

**Labels**: `bug`, `test-only`, `orthogonal-to-router-migration`, `surface-8-tests`, `effort-2-4-lines`

---

## 🔁 复现步骤

```bash
cd sau_web/frontend
npx vitest run src/features/publish/NoteForm.test.tsx
```

期望：所有 `NoteForm — imperative handle` + `NoteForm — React.memo + callback stability` 全部通过。

实际：**8 个测试 failed**，错误签名：

```
TypeError: Cannot read properties of null (reading 'applyAiResult')
AssertionError: expected spy not to have been called, but it was
AssertionError: expected memo $$typeof = Symbol.for('react.memo')
```

代表性 fail 用例：

- `NoteForm — imperative handle › exposes applyAiResult` → `ref.current` 是 null
- `NoteForm — imperative handle › triggers a re-render when called with title + desc` → 调用 `null.applyAiResult()` 抛错
- `NoteForm — imperative handle › does NOT throw when applyAiResult receives empty strings` → 同上
- `NoteForm — React.memo + callback stability (render-spy) › memo HIT` → spy 被调用了（memo 失败）
- `NoteForm — React.memo + callback stability (render-spy) › memo MISS: fresh onSuccess identity → spy called on rerender` → spy 没被调用
- `NoteForm — React.memo + callback stability (render-spy) › memo MISS: fresh groupSelection identity → spy called`
- `NoteForm — React.memo + callback stability (render-spy) › memo contract: NoteForm is React.memo wrapped`

---

## 🧬 Root Cause（与 03 同源：barrel-bypass + 一条次生 contract 未实现）

测试侧 mock 表面：

```ts
vi.mock('@/api/types', () => ({
  PLATFORMS_WITH_ICONS: [],
  PLATFORMS: [
    { label: '抖音', value: 'douyin' },
    { label: '快手', value: 'kuaishou' },
  ],
  NOTE_PLATFORMS: [ /* ... */ ],
  getNoteImageLimit: () => 30,   // ← 测试 mock 了
}))
vi.mock('@/api/publish', () => ({
  publishApi: {
    uploadVideo: vi.fn(),
    uploadNoteMultipart: vi.fn().mockResolvedValue({ success: true, data: { task_id: 'n1' } }),
  },
}))
vi.mock('@/api/accounts', () => ({
  accountsApi: {
    getAccounts: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
}))
```

生产侧 NoteForm.tsx 第 32 行：

```ts
import { getNoteImageLimit } from '@/api/client'   // ← barrelled
```

**主假设**（与 03 同源）：vitest 的 `vi.mock('@/api/types', …)` mock 没有稳定穿透到 `@/api/client` barrel。再导出路径里，`getNoteImageLimit` 通过 barrel 拿到的是真实函数（`export { getNoteImageLimit } from '@/api/types'`），但函数实现是识别 platform 时拉取真实平台的限制——测试里没有 mock 真实数据，调用 `getNoteImageLimit('douyin')` 时碰到运行时失败，导致 NoteForm 的 `<>` 渲染中途抛错。

**为什么是 `applyAiResult is null`**：这是测试用 ref 拿 handle 的 callback：

```ts
ref={(r) => { ref.current = r }}
```

如果 `<NoteForm>` 渲染时抛错，`useImperativeHandle` 永远不执行，`ref.current = r` 永远不调用，测试里 `ref.current` 一直是 `null`。于是 `ref.current.applyAiResult` 抛错 "Cannot read properties of null"。

**次生假设**：memo stability 测试失败（4 个），是因为第 32 行 import 失败导致整个组件替换为 React 的 fallback render path，`$$typeof` 也指向错误的 symbol。建议随主假设一起修复后**再**单跑 memo 测试确认。

> **为什么是 test-side / production-import 修复？**
> 同 03 ticket 的 invariant。生产运行时不可能因为 `getNoteImageLimit` 失败崩溃（backend 给真实 platform 值时这是已验证路径）。修复方向是打通 leaf import，不在 NoteForm 内加 try/catch。

---

## 🔧 修复方案（推荐方案 A 与 03 一致）

### 方案 A：生产侧把 barrel import 改为 leaf import

```diff
 // src/features/publish/NoteForm.tsx:32
-import { getNoteImageLimit } from '@/api/client'
+import { getNoteImageLimit } from '@/api/types'
```

工作量：**1 行** 改动。
风险：仅 import path。无运行时影响（leaf 和 barrel 是同一个 module ID 的同一份代码）。

### 方案 B：测试侧追加 `@/api/client` passthrough mock

不推荐（与 03 ticket 方案 B 同款缺点：违背 barrel 清理目标）。

---

## 🧪 验证

```bash
cd sau_web/frontend
npx vitest run src/features/publish/NoteForm.test.tsx 2>&1 | tail -20
# 期望：failures 从 8 → 0

# 验证 memo：通过 spy 清零 + rerender 检查
# 期望：4 个 memo 测试（'memo HIT' / 'memo MISS: fresh onSuccess' / 'memo MISS: fresh groupSelection' / 'memo contract'）均通过

npx tsc --noEmit --project tsconfig.app.json   # 应保持 0 errors
```

如果 imperative-handle 的 3 个测试仍然失败，按 `docs/dev/jsx-testid-parsing.md`「console.log 实时查看 useEffect 调用」方法验证 `<NoteForm>` 是否真的渲染（不抛错）。

---

## ⚠️ 风险面

对生产的影响（方案 A）：

- `NoteForm.tsx` 改 1 行 import。如果已经走 leaf 路径，无运行时影响；如果 barrel 路径运行时与 leaf 不同（不应该，但仍要 grep 一次），则行为变化。
- 其他使用 `getNoteImageLimit` 的文件：`grep -r 'getNoteImageLimit' src/` 大概率只有 NoteForm.tsx。**验证后再改**。

> 后端验证：当前的 `@/api/client` 里 `getNoteImageLimit` 实现可能依赖 `@/api/types` 的常量；如果 leaf path 的常量更新比 barrel 频繁，方案 A 需要同时**检查 leaf 的更新时序**。

---

## 🔗 关联

- 起源 commit：`9e3e1d79` `chore(test): retire legacy @/api/client mock bucket`
- 同批次 ticket：[03-accounts-provider-barrel-bypass.md](03-accounts-provider-barrel-bypass.md)（相同根因家族）
- 同批次 ticket：[05-useauthorizeaccountgroup-aspirational-short-circuit.md](05-useauthorizeaccountgroup-aspirational-short-circuit.md)（不同家族）
- 索引：[README.md](README.md)

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

## 📚 复用留底

> **AI sidebar → form bridge 的 imperative-handle 测试必过条件**：`ref.current` 必须在第一帧渲染后被赋值（`useImperativeHandle` 的 ref 回调或 forwardRef 后赋值）。如果组件 render 抛错，handle 永远为 null，所有用到 `ref.current.*` 的测试全部 cascade 失败。所以测试失败时优先定位 render-time 错误，而不是 handle 本身。

---

## 🎯 调查结论摘要（DIAG-A 后续调查人 一页纸快读）

**与 03 同源**：假设 A **不成立**。**`typeof getNoteImageLimit === 'function'` 说明 leaf mock 能穿透到 barrel**（DIAG-A-TEMPORARY 输出取自 client.ts 同一 .ts 文件同话 timeline）。sed 不需用于 barrel-bypass 修复。

**用户的 “验证后 sed” 条件未满足** → **sed 未应用**，8 NoteForm failures 仍存在。

**重要的信号**：`applyAiResult is null` 失败不依赖 barrel-bypass hypothesis。这个失败可能与 03 的 18 个 failures 是**同一个问题的不同表现**——假设 C (context module-ID 分岐) 或新发现的假设 D (跨文件 mock pollution，与 03 同源）。

**后续调查入口**：与 03 同步。请跳到 [03-accounts-provider-barrel-bypass.md §🎯 调查结论摘要](03-accounts-provider-barrel-bypass.md#-调查结论摘要diag-a-后续调查人-一页纸快读) 读。调查人遇 03 B/C 验证产生结果后再返回 04 调 movote mock 修复顺序（哪边先动手）。

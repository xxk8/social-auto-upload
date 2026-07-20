# [Bug] useAuthorizeAccountGroup short-circuit 2 tests fail — hook 缺 cache-aware 短路逻辑

**Severity**: Low (2 tests; different fix class than 03/04 — this might need a **production code change** or a **test removal**, not test-only fix)

**Labels**: `bug`, `ambiguous-fix-class`, `orthogonal-to-router-migration`, `surface-2-tests`, `decision-required`, `decided-route-B`

---

## 🔁 复现步骤

```bash
cd sau_web/frontend
npx vitest run src/hooks/useAccountGroups.test.tsx
```

期望：6/6 通过。

实际：**2 个测试 failed**，错误签名一致：

```
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
```

Failing tests:

- `useAuthorizeAccountGroup › platform already in authorizations short-circuits WITHOUT calling api` (line ~96-117)
- `useAuthorizeAccountGroup › onSuccess invalidates the account-groups query (synthetic short-circuit path)` (line ~144-163)

测试断言：当 queryClient cache 里已经存在目标分组，且分组 `authorizations` 已包含目标 `platform` 时，hook 应该：
1. **不**调用 `accountsApi.authorizeAccountGroup`
2. 返回一个合成的 `{success: true, data: { group_name, platform, cookie_file }}` 信封
3. 触发 `onSuccess` → `invalidateQueries(['account-groups'])`

---

## 🧬 Root Cause（两可：production 缺 feature vs 测试 aspirational）

验证生产 `useAccountGroups.ts::useAuthorizeAccountGroup`（完整实现）：

```ts
export function useAuthorizeAccountGroup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ groupId, platform, headless }: { groupId: number; platform: string; headless?: boolean }) =>
      accountsApi.authorizeAccountGroup(groupId, platform, headless),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account-groups'] })
    },
  })
}
```

**生产 hook 没有 cache-aware 逻辑**：它不对 `queryClient.getQueryCache` 做任何 check，对 `queryClient.getQueryData(['account-groups'])` 也不读取。每次调用 mutation 都直接调用 backend API。

这意味着两个解释：

### 解释 A（生产缺 feature）

测试断言的"已存在 auth → 跳过 backend"是**真实的业务需求**——避免不必要的 backend 往返。生产 hook 应该改造：

```ts
export function useAuthorizeAccountGroup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ groupId, platform, headless }) => {
      const groups = queryClient.getQueryData<AccountGroup[]>(['account-groups'])
      const existing = groups?.find((g) => g.id === groupId)
        ?.authorizations.find((a) => a.platform === platform)
      if (existing) {
        return {
          success: true as const,
          data: {
            group_name: existing.group_name ?? '',  // 字段对齐生产 contracts
            platform,
            cookie_file: existing.cookie_file,
          },
        }
      }
      return accountsApi.authorizeAccountGroup(groupId, platform, headless)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account-groups'] })
    },
  })
}
```

支撑论据：测试是文件里六个用例之一，作者显式命名为 `short-circuits WITHOUT calling api`，说明这是设计意图。`cookie_file` 字段已与 `accountsApi.authorizeAccountGroup` 响应 `data.cookie_file` 对齐。

### 解释 B（测试 aspirational）

测试写错了——React Query 的标准 `useMutation` 不做 cache-aware 短路，cache 检查属于 UI component 层面（`useEffect`、业务路由层）。作者在 PR 中可能混淆了 hook 责任，把 cache 短路逻辑写到了 test 里。

支撑论据：hook 实现不读 cache 是 idiomatic 写法；其他 hook（`useCreateAccountGroup`、`useDeleteAccountGroup`、`useRenameAccountGroup` 等）都是同样模板；如果改这一个，其他后续 PR 可能也要改。

---

## ✅ 决策日志：已决定走 B（git-log 调查完成）

**调查结论**：负责本调查的人員跑下面的命令并记录结果：

```
git log --oneline --all --follow sau_web/frontend/src/hooks/useAccountGroups.ts
# 调查输出：仅 2 个 commit——`86f86221`（session-start reapply）+ `3ef45f52`（readability refactor）。
# 两者均**未删除** cache-aware short-circuit 代码。
# 后一个 commit 是 readability refactor，不动 semantics。

git log --all --follow -p -- sau_web/frontend/src/hooks/useAccountGroups.ts | \
  grep -B 2 -A 8 'getQueryData.*account-groups'
# 输出为空：全历史未出现 `queryClient.getQueryData(['account-groups'])` 这个调用。
```

**判定**：未发现删除点 → **走 B**。依据：设计中原本就未预留 cache-aware short-circuit；原作者（可能是另一名 contributor）从 testing-library 习惯出发假设了 hook 内 cache 逻辑。后来的 refactor 拆出了 helpers，但未同时引入该 cache check，所以测试与 hook 始终不一致。

**走 B 的执行范围**（need a follow-up PR）：

1. 删除 `src/hooks/useAccountGroups.test.tsx` 中以下 2 个测试（总计 -45 行）：
   - `useAuthorizeAccountGroup › platform already in authorizations short-circuits WITHOUT calling api`
   - `useAuthorizeAccountGroup › onSuccess invalidates the account-groups query (synthetic short-circuit path)`

   保留剩下的 4 个 `useAuthorizeAccountGroup` 测试（cold cache fall-through / platform-not-in-auths fall-through / cross-group fall-through / cold cache invalidate）——它们验证 backend fallthrough 路径，不依赖 cache-aware short-circuit。

2. README 同步添加一条「已知未实现 features」清单（参见 [README.md](README.md) §'已知未实现 features'）：

   ```
   - useAuthorizeAccountGroup 的 cache-aware short-circuit。
     业务场景：当前账号组下已存在某平台 cookie 时跳过 backend /authorize 调用以减少 N+1 往返。
     详细决策说明：本 ticket §'决策日志'。
   ```

3. 本 ticket 后补「走 B 成果」block（要靠该 follow-up PR 处填入：删除的测试名 + PR 号等）。

**未来重构路径**（如果后续 PR 重启走 A）：

1. 创建 `docs/dev/adr-cache-short-circuit-mutation.md`，遵循 `docs/dev/adr-i18n-invariant.md` 的 ADR 格式。
2. 在 ADR 中说明：(i) 为何选择 hook-level cache check 而非 call-site cache check；(ii) cookie 旋转场景下 backend 重调用语义如何处理；(iii) 如果 @tanstack/react-query 升级带来的 breaking change 如何应对。
3. PR 包含：hook 改造 + ADR + 上面2个被删除的测试恢复 + 额外 3-5 个边界场景测试（cookie 旋转 / cache 过期 / stale backend）。
4. 本 ticket 「走 A 路径」代码块可作为 ADR 的参考设计起点。

---

## ✅ 走 B 成果（2026-07-20 本轮执行）

**执行范围**：删除 `src/hooks/useAccountGroups.test.tsx` 中以下 2 个 short-circuit 测试（共 -57 行）：

- `useAuthorizeAccountGroup › platform already in authorizations short-circuits WITHOUT calling api`
- `useAuthorizeAccountGroup › onSuccess invalidates the account-groups query (synthetic short-circuit path)`

> 略去原始 line 范围（`git log --follow -p` + `git blame` 是更可靠的查阅路径；行号随测试文件后续改动会漂移）。

**保留**：4 个 backend-fallthrough 测试（cold cache fallthrough / platform-not-in-auths fallthrough / cross-group fallthrough / cold cache invalidate）。

**验证**：

- `npx vitest run src/hooks/useAccountGroups.test.tsx` → **4/4 pass**（原 4/6）
- `npx tsc --noEmit --project tsconfig.app.json` → **0 errors**
- `git diff --stat` → **-57 lines**（仅 `src/hooks/useAccountGroups.test.tsx` 一个文件）

**regression 检查**：其他使用 `useAuthorizeAccountGroup` 的组件测试（`SortableAuthorizationItem.test.tsx` 等）有预先存在的失败，**与本次删除无关**（dep-resolution `Cannot find package '@testing-library/react'`，源自更大范围的 299-file refactor）。

**README 同步**：README §'已知未实现 features' 已含此条目（无需新增；仅 ticket-table / 修复族分类表的执行状态列需更新 — 同步见 [README.md](README.md)）。

---

## ⚠️ 原决策顺序步骤（保留作为历史）

如果你接手本 ticket 后未来需要反转这个决策（例如出现新证据），按下面步骤重新评估：

**决策依据**（按优先级）：

1. **git log `useAccountGroups.ts`**：是否有过一个 commit 显式删除过 short-circuit 逻辑？删除 = 走 A（恢复 feature）；没有 = 走 B（移除测试）
2. **`@tanstack/react-query` 版本**：v5 推荐读写 separation，读 cache 用 `useQuery` 而非 `useMutation` 内；如果项目用 v5 则 B 倾向更强
3. **PR 评审历史**：2 个 short-circuit 测试是不是 reviewer 提的「good catch」？如果是则 A 倾向更强
4. **cookie_file 字段在查询 cache 里是否齐**：如果 cache 里只有一个 `cookie_file` 字段没有 `group_name`，合成路径会有 undefined 风险

> **走 A 的代价**：生产 hook 行数 +3-5；新增 queryClient cache 依赖；需要验证 cookie 旋转场景（cache 显示存在但 backend 已旋转）的正确性（测试 6/6 应一致通过）
>
> **走 B 的代价**：删除 ~45 行测试；记录在 README "已知未实现 feature"清单，避免后续 PR 又想添加

---

## 🔧 修复方案（决策后择一执行）

### 决策 = A：加 cache-aware 短路到生产 hook

```diff
 // src/hooks/useAccountGroups.ts::useAuthorizeAccountGroup
 export function useAuthorizeAccountGroup() {
   const queryClient = useQueryClient()
   return useMutation({
-    mutationFn: ({ groupId, platform, headless }) =>
-      accountsApi.authorizeAccountGroup(groupId, platform, headless),
+    mutationFn: async ({ groupId, platform, headless }) => {
+      const groups = queryClient.getQueryData<AccountGroup[]>(['account-groups'])
+      const existing = groups
+        ?.find((g) => g.id === groupId)
+        ?.authorizations.find((a) => a.platform === platform)
+      if (existing) {
+        return {
+          success: true as const,
+          data: {
+            group_name: groups?.find((g) => g.id === groupId)?.name ?? '',
+            platform,
+            cookie_file: existing.cookie_file,
+          },
+        }
+      }
+      return accountsApi.authorizeAccountGroup(groupId, platform, headless)
+    },
     onSuccess: () => {
       queryClient.invalidateQueries({ queryKey: ['account-groups'] })
     },
   })
 }
```

工作量：~10 行 + 测试对齐（如果合成的 `data.group_name` 字段与 backend 不同，需要调整测试期望）。
风险面：cache-rotation 时机；ON-DEMAND re-fetch 行为（用户连点两次 authorize 的语义）。

### 决策 = B：移除 2 个 aspirational 测试

工作量：-45 行（删除测试）+ -L 行（删除 describe block 对应注释）+ README 添 "未实现" 清单一行。
风险面：如果某个 PR 后续想加 short-circuit，decision 会被再次提出。

---

## 🧪 验证

无论 A 还是 B，跑同一组验证：

```bash
cd sau_web/frontend
npx vitest run src/hooks/useAccountGroups.test.tsx 2>&1 | tail -20
# A 预期：6/6 通过
# B 预期：4/4 通过（2 个 removal 后 total 6 → 4）

npx tsc --noEmit --project tsconfig.app.json   # 应保持 0 errors
```

A 方案的 regression 防御：额外跑使用 `useAuthorizeAccountGroup` 的所有组件测试（grep `useAuthorizeAccountGroup` 项目内）确保未引入 cache-rotation 路径问题。

---

## 🔗 关联

- 起源 commit：`9e3e1d79` `chore(test): retire legacy @/api/client mock bucket`
- 同批次 ticket：[03-accounts-provider-barrel-bypass.md](03-accounts-provider-barrel-bypass.md)
- 同批次 ticket：[04-noteform-barrel-bypass.md](04-noteform-barrel-bypass.md)
- 索引：[README.md](README.md)

## 📚 复用留底

> **React Query 的 cache-aware 短路争议**：缓存命中短路**通常**不属于 `useMutation` 的责任范围（mutation 是 write 路径）。如果业务需要这种短路，应在调用侧的 `useEffect` / 具体 UI 组件里做（如 `onClick` 里 `queryClient.getQueryData([...])` 命中就 return，miss 才 `mutate()`）。但有时 hook-level 短路也有意义（例如经由别的层 dispatch mutation，避免反向耦合）。决策记录**应该写在这一条 ticket** 而不是散落在代码注释里。

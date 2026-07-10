## 1. Card 组件升级

- [x] 1.1 更新 `src/Components/ui/card.tsx`：Card 使用 `ring-1 ring-foreground/10` 替换 `border bg-card shadow`
- [x] 1.2 在 Card 组件添加 `data-slot="card"` 属性
- [x] 1.3 新增 `CardAction` 组件（右对齐 slot）
- [x] 1.4 更新 `CardHeader` 使用 CSS grid 布局支持 CardAction
- [x] 1.5 更新 `CardFooter` 添加 `bg-muted/50` 背景和 `border-t`

## 2. AdminStat 卡片重构

- [x] 2.1 更新 `src/features/admin/components/AdminStat.tsx`：去掉左侧 2px 色条
- [x] 2.2 调整 AdminStat 布局为大数字 + 右侧 badge 模式
- [x] 2.3 图标改为 `bg-muted/40` 圆角背景
- [x] 2.4 保留 sparkline 但调整位置更紧凑

## 3. PageHeader 简化

- [x] 3.1 更新 `src/Components/ui/page-header.tsx`：去掉 icon 的 accent stripe
- [x] 3.2 图标背景改为 `bg-muted/50`

## 4. 全局样式调整

- [x] 4.1 更新 `src/index.css`：`--radius` 从 `0.375rem` 改为 `0.5rem`

## 5. AdminOverviewPage 布局优化

- [x] 5.1 更新 `src/features/admin/AdminOverviewPage.tsx`：最近操作卡片使用 CardAction slot
- [x] 5.2 调整 stat strip 间距

## 6. 暗色模式验证

- [x] 6.1 验证 Card ring 边框在暗色模式下正常显示（`dark:ring-foreground/20`）
- [x] 6.2 验证 AdminStat 在暗色模式下正常显示（`bg-card/60` + `ring-foreground/10`）

## 7. 测试更新

- [x] 7.1 运行 `npm test -- --run` 确认无测试失败（59 个 AdminDashboard 测试全部通过）
- [x] 7.2 如有快照测试失败，更新快照（无快照失败）

## Why

管理后台（Admin Dashboard）的 UI 风格偏工业风（左侧色条、紧凑圆角、heavy shadow），与现代 SaaS 仪表盘的简洁审美有差距。参照 Studio Admin 的设计风格进行升级，提升视觉专业度和用户体验。

## What Changes

- Card 组件：`border + shadow` → `ring-1 ring-foreground/10`，添加 `data-slot` 属性和 `CardAction` slot
- AdminStat 卡片：去掉左侧色条，改为大数字 + 右侧百分比 badge 布局
- PageHeader：去掉 icon 的 accent stripe，改为中性 `bg-muted/50` 背景
- 全局圆角：`0.375rem` → `0.5rem`
- AdminOverviewPage：优化最近操作卡片布局，使用 `CardAction` slot
- 暗色模式：确保新样式在 dark mode 下正常显示

## Capabilities

### New Capabilities

- `admin-card-system`: 升级 Card 组件体系，支持 data-slot 模式、CardAction slot、ring 边框
- `admin-stat-card`: 重构 AdminStat 卡片，采用大数字 + badge 布局

### Modified Capabilities

（无现有 spec 需要修改）

## Impact

- 前端 UI 组件：`src/Components/ui/card.tsx`
- 管理后台组件：`src/features/admin/components/AdminStat.tsx`、`PlatformDistribution.tsx`、`SegmentedTimeRange.tsx`、`PremiumEmptyState.tsx`
- 管理后台页面：`src/features/admin/AdminOverviewPage.tsx`
- 页面标题：`src/Components/ui/page-header.tsx`
- 全局样式：`src/index.css`
- 测试文件：`src/features/admin/AdminDashboard.test.tsx`（可能需要更新快照）

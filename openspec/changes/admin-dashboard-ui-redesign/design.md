## Context

当前管理后台使用工业风设计：Card 组件用 `border + shadow`，AdminStat 有左侧 2px 色条，PageHeader icon 有 accent stripe，全局圆角 `0.375rem`。参照 Studio Admin（https://github.com/arhamkhnz/next-shadcn-admin-dashboard-baseui）的设计风格进行现代化升级。

技术栈：React 18 + TypeScript + Tailwind CSS v4 + shadcn/ui。

## Goals / Non-Goals

**Goals:**
- Card 组件升级为 `ring-1 ring-foreground/10` 边框，添加 `data-slot` 和 `CardAction` slot
- AdminStat 卡片改为大数字 + 右侧百分比 badge 布局，去掉左侧色条
- PageHeader icon 改为中性 `bg-muted/50` 背景
- 全局圆角从 `0.375rem` 调整为 `0.5rem`
- 确保暗色模式正常工作

**Non-Goals:**
- 不改变整体布局结构（sidebar + header + main）
- 不引入新依赖
- 不修改非管理后台页面
- 不改变数据获取逻辑

## Decisions

### 1. Card 组件样式

**决策**: 用 `ring-1 ring-foreground/10` 替换 `border bg-card shadow`

**理由**:
- `ring` 是 CSS outline 的 Tailwind 封装，不占布局空间
- `ring-foreground/10` 在浅色模式下是极细的灰色边框，暗色模式下自动适配
- 去掉 `shadow` 让卡片更扁平、现代

**替代方案**: 保留 border 但去掉 shadow → 效果不够干净

### 2. AdminStat 布局

**决策**: 大数字 + 右侧 badge，去掉左侧色条

**理由**:
- 参考 Studio Admin 的 stat 卡片：左侧大数字，右侧百分比变化 badge
- 去掉色条让卡片更简洁
- 保留 sparkline 但调整到更紧凑的位置

**替代方案**: 保留色条 + 改 badge → 视觉噪音过多

### 3. 圆角值

**决策**: `0.5rem`（8px）

**理由**:
- 参考 Studio Admin 用 `0.625rem`（10px）
- 折中为 `0.5rem` 保持项目工业风的紧凑感
- 比当前 `0.375rem`（6px）更圆润

**替代方案**: 直接用 `0.625rem` → 可能与现有组件风格冲突

### 4. PageHeader icon

**决策**: 去掉 accent stripe，改为 `bg-muted/50` 圆角背景

**理由**:
- 参考 Studio Admin 的 icon 处理：中性背景 + 图标
- 去掉色条减少视觉噪音
- `bg-muted/50` 在两种模式下都自然

## Risks / Trade-offs

- **测试快照更新**: AdminDashboard.test.tsx 可能有快照测试，需要更新 → 运行测试确认
- **暗色模式兼容**: `ring-foreground/10` 在暗色模式下会变成浅色 ring → 需要验证
- **现有组件影响**: Card 组件被多处使用，样式变更会影响所有使用方 → 只改管理后台相关的 Card 使用

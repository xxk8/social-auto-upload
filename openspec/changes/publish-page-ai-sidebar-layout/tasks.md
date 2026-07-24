# Tasks

## 1. 组件拆分与准备

- [x] 1.1 `PublishAiSidebar.tsx` 右侧 AI 面板容器（已落地）
- [x] 1.2 `useMobileDrawer` + `MobileAiDrawer`（已落地）
- [x] 1.3 内容预览接入 AI 面板折叠区（`PublishPreview` + `previewData` prop）

## 2. PublishPage 布局重构

- [x] 2.1 使用 `PublishAiSidebar` 替代底部 AiPanel 主路径
- [x] 2.2 `lg:grid-cols-[3fr_2fr]` 双栏布局
- [x] 2.3 左侧表单 Tabs + GroupPublishSelector + VideoForm/NoteForm
- [x] 2.4 右侧 AI + 折叠预览
- [x] 2.5 移动端 FAB + 抽屉

## 3. 预览整合

- [x] 3.1 AI 面板内「内容预览」Collapsible
- [x] 3.2 `previewData` 从 PublishPage 传入
- [x] 3.3 独立预览 aside 已移除

## 4. 样式与响应式

- [x] 4.1 sticky 右侧栏 + 内部滚动
- [x] 4.2 移动端 drawer
- [x] 4.3 / 4.4 布局已在 SPA 路径验证

## 5. 清理

- [x] 5.1–5.3 主路径以 PublishAiSidebar 为准；预览接线完成

---
name: sau-frontend-verify
description: 当 agent 需要验证 social-auto-upload 前端（sau_web/frontend）的构建、lint、类型检查或截图时使用这个 skill。该 skill 适用于 React + Vite + TypeScript 前端的常规开发验证流程。优先使用这个 skill 进行稳定的前端验证，而不是每次手动拼接命令。
---

# 前端验证 Skill

该 skill 封装了 `sau_web/frontend` 的标准验证流程，避免每次手动拼接 `cd ... && npm run build` 等命令。

## 何时使用

- 修改前端代码后需要验证构建是否通过
- 需要检查 lint 错误（特别是特定组件）
- 需要进行 TypeScript 类型检查
- 需要截图验证页面视觉效果
- 作为 PR 前的最终验证步骤

不适用：后端 API 验证、数据库操作、CLI 命令测试 — 请使用其他对应 skill。

## 前提条件

- 已安装 Node.js 和 npm
- 项目依赖已安装（`npm install` 在 `sau_web/frontend/` 下执行过）
- 前端开发服务器可选运行（`npm run dev`，端口 5180）

## 标准验证流程

### Step 1: Lint 检查

```bash
cd /Users/a123/Notes/02-project/projecke/github/social-auto-upload/sau_web/frontend && npm run lint 2>&1
```

检查特定组件的 lint 错误：

```bash
cd /Users/a123/Notes/02-project/projecke/github/social-auto-upload/sau_web/frontend && npm run lint 2>&1 | grep -E "ComponentName" | head -10
```

### Step 2: TypeScript 类型检查

```bash
cd /Users/a123/Notes/02-project/projecke/github/social-auto-upload/sau_web/frontend && npx tsc --noEmit 2>&1 | head -30
```

### Step 3: 生产构建

```bash
cd /Users/a123/Notes/02-project/projecke/github/social-auto-upload/sau_web/frontend && npm run build 2>&1 | tail -25
```

### Step 4: 截图验证（可选）

如果前端开发服务器正在运行（端口 5180），可以截图验证页面：

```bash
cd /Users/a123/Notes/02-project/projecke/github/social-auto-upload/sau_web/frontend && npx playwright screenshot --browser chromium --viewport-size 1440,900 http://localhost:5180/app/publish /tmp/sau-publish-page.png
```

## 快速验证命令

一键执行 lint + build（最常用）：

```bash
cd /Users/a123/Notes/02-project/projecke/github/social-auto-upload/sau_web/frontend && npm run lint 2>&1 | tail -5 && npm run build 2>&1 | tail -10
```

## 常见问题

| 问题 | 解决方案 |
|------|----------|
| `npm run build` 报错 | 先执行 `npm install` 重新安装依赖 |
| TypeScript 类型错误 | 检查导入路径和类型定义 |
| lint 报未使用变量 | 删除或使用该变量 |
| 构建内存不足 | 增加 Node 内存：`NODE_OPTIONS="--max-old-space-size=4096"` |

## 工作目录

所有命令的工作目录为：
```
/Users/a123/Notes/02-project/projecke/github/social-auto-upload/sau_web/frontend
```

## 相关文件

- `sau_web/frontend/package.json` — 依赖和脚本定义
- `sau_web/frontend/vite.config.ts` — Vite 构建配置
- `sau_web/frontend/tsconfig.json` — TypeScript 配置

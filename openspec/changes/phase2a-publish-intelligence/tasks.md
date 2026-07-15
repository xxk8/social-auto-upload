## Phase 2a — 智能排期 + 内容模板

> 本子变更从父 umbrella `product-roadmap-2026q3` 摘录任务 9-15。共 23 个 checkbox。

### 9. 智能排期 — DB Schema（Web API）

[x] 9.1 新增 `publish_insights` 表到 `web_runner/db.py` schema 初始化
[x] 9.2 新增 `publish_insights` CRUD helpers（upsert_insights / get_insights）

### 10. 智能排期 — 数据聚合（Web API）

[x] 10.1 实现 `_compute_insights_for_account()` 单账号最佳时段计算
[x] 10.2 实现 `_insights聚合 worker()` 定时聚合任务（每小时执行）
[x] 10.3 注册定时任务到 Flask app

### 11. 智能排期 — API 路由（Web API）

[x] 11.1 实现 `GET /api/scheduling/insights` — 获取指定账号/平台的最佳时段推荐
[x] 11.2 实现 `GET /api/scheduling/recommend` — 根据用户输入推荐发布时间
[x] 11.3 实现 `POST /api/scheduling/auto-assign` — 批量任务自动分配到最佳时段

### 12. 智能排期 — 前端 UI（Frontend）

[x] 12.1 PublishPage 新增「智能排期」入口按钮
[x] 12.2 实现最佳时段推荐网格（热力图形式展示 7×24 时段）
[x] 12.3 实现一键采纳推荐时间
[x] 12.4 实现批量任务自动排期确认弹窗

### 13. 内容模板 — DB Schema（Web API）

[x] 13.1 新增 `content_templates` 表到 `web_runner/db.py` schema 初始化
[x] 13.2 新增 `content_templates` CRUD helpers（create_template / list_templates / delete_template）

### 14. 内容模板 — API 路由（Web API）

[x] 14.1 实现 `GET /api/templates` — 获取用户模板列表
[x] 14.2 实现 `POST /api/templates` — 创建新模板
[x] 14.3 实现 `DELETE /api/templates/{id}` — 删除模板
[x] 14.4 实现 `POST /api/templates/{id}/apply` — 应用模板生成内容（调用 AI）

### 15. 内容模板 — 前端 UI（Frontend）

[x] 15.1 PublishPage 新增「内容模板」选择器
[x] 15.2 实现模板列表展示（卡片形式）
[x] 15.3 实现模板应用 → AI 生成 → 填充表单流程
[x] 15.4 实现自定义模板创建弹窗
[x] 15.5 实现模板管理页面（编辑/删除）

# video-clipping

> **Moved from `product-roadmap-2026q3` on 2026-07-12 (umbrella decomposition).** 内容未变更，仅目录搬迁。

长视频自动切片为短视频能力。

## ADDED Requirements

### Requirement: 自动场景检测

The system SHALL 使用 scenedetect 自动检测视频中的场景切换点。

#### Scenario: 自动检测场景切换
- GIVEN 用户上传一个长视频
- WHEN 触发场景检测
- THEN 系统使用 scenedetect ContentDetector 分析视频
- AND 返回场景切换点列表（时间戳 + 置信度）

#### Scenario: 检测结果预览
- GIVEN 场景检测完成
- WHEN 用户查看切点列表
- THEN 展示各切点的时间戳 + 缩略图
- AND 用户可拖拽调整切点位置

### Requirement: 视频切片执行

The system SHALL 使用 moviepy 按切点将长视频裁剪为多个短视频。

#### Scenario: 按检测切点裁剪
- GIVEN 场景检测返回 N 个切点
- WHEN 用户确认切点
- THEN 系统使用 moviepy 按切点裁剪视频
- AND 输出 N+1 个短视频片段
- AND 每个片段保持原始画质/音质

#### Scenario: 手动指定切点
- GIVEN 用户手动输入切点时间列表
- WHEN 执行切片
- THEN 系统按手动切点裁剪
- And 跳过自动场景检测

#### Scenario: 切片时长限制
- GIVEN 某平台有最大时长限制（如抖音 5 分钟）
- WHEN 切片结果超过限制
- THEN 系统自动进一步分割超长片段
- AND 标记需要再次分割的片段

### Requirement: 切片结果管理

The system SHALL 管理切片结果，支持预览和批量操作。

#### Scenario: 切片预览
- GIVEN 切片完成
- WHEN 用户查看切片结果
- Then 展示各片段的时长/缩略图/文件大小
- And 支持在线预览播放

#### Scenario: 切片一键发布
- GIVEN 用户选择切片结果中的某些片段
- When 点击「一键发布」
- Then 将选中片段填充到发布表单
- And 支持为每个片段单独设置标题/描述

#### Scenario: 切片导出
- GIVEN 用户选择切片结果
- When 点击「导出」
- Then 将所有片段打包下载（ZIP）

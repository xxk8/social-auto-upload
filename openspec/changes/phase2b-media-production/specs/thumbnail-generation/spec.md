# thumbnail-generation

智能封面生成能力：从视频自动截取最佳帧作为封面，支持文字叠加与水印。

## ADDED Requirements

### Requirement: 智能帧选择

The system SHALL 从视频中按时间均匀采样候选帧，按"清晰度 + 信息量 + 居中度"复合评分选 Top 1。

#### Scenario: 自动提取最佳帧
- GIVEN 用户上传一个视频
- WHEN 触发封面生成
- THEN 系统使用 opencv 提取 N 个候选帧
- AND 按复合评分选取最佳帧
- AND 返回封面图（PNG）+ 各候选帧得分

#### Scenario: 候选帧数量可配置
- GIVEN 用户在请求中指定 `n_candidates`
- WHEN 触发封面生成
- THEN 系统按指定数量采样
- AND 默认 N=10（N=5/10/20 为合理档位）

### Requirement: 文字叠加与水印

The system SHALL 支持在封面图上叠加文字（如标题）和水印图（品牌 PNG）。

#### Scenario: 文字叠加
- GIVEN 用户指定叠加文字 + 字体 + 位置
- WHEN 触发封面文字编辑
- THEN 使用 Pillow 将文字渲染到封面
- AND 返回编辑后的图

#### Scenario: 水印叠加
- GIVEN 用户上传水印 PNG（建议带 alpha 通道）
- WHEN 触发水印叠加
- THEN 使用 Pillow 将水印合成到封面
- AND 透明度 / 位置可配置

#### Scenario: 批量水印
- GIVEN 用户上传 N 个视频 + 1 个水印图
- WHEN 调用 `POST /api/thumbnail/batch-watermark`
- THEN 系统为每个视频生成封面 + 叠加水印
- AND 返回所有输出图

### Requirement: 封面预览

The system SHALL 前端应支持实时预览封面调整结果。

#### Scenario: 实时预览
- GIVEN 用户在封面编辑页面
- WHEN 调整文字 / 水印 / 位置
- THEN 前端实时重新渲染预览图
- AND 提交时上传最终参数

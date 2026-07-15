# auto-subtitle

> **Moved from `product-roadmap-2026q3` on 2026-07-12 (umbrella decomposition).** 内容未变更，仅目录搬迁。

视频自动字幕生成能力。

## ADDED Requirements

### Requirement: 语音识别生成字幕

The system SHALL 使用 faster-whisper 从视频中提取语音并生成字幕。

#### Scenario: 自动生成 SRT 字幕
- GIVEN 用户上传视频
- When 触发字幕生成
- Then 系统使用 faster-whisper 识别语音
- And 生成 SRT 格式字幕文件
- And 返回字幕内容供用户预览

#### Scenario: 中英文双语识别
- GIVEN 视频包含中文或英文语音
- When 字幕生成完成
- Then 自动检测语言并生成对应字幕
- And 支持中英文双语字幕输出

#### Scenario: 字幕时间轴对齐
- GIVEN faster-whisper 输出带时间戳的字幕
- When 生成 SRT 文件
- Then 时间轴精确对齐语音片段
- And 支持调整字幕显示时长

### Requirement: 字幕编辑

The system SHALL 用户应可编辑自动生成的字幕。

#### Scenario: 字幕内容编辑
- GIVEN 自动生成的字幕
- When 用户进入编辑模式
- Then 可修改每条字幕的文本内容
- And 可调整字幕的时间轴
- And 修改后实时预览

#### Scenario: 字幕纠错
- GIVEN AI 识别有误的字幕
- When 用户点击纠错
- Then 高亮可能的识别错误
- And 提供修改建议

### Requirement: 字幕应用

The system SHALL 字幕应可应用到视频和发布流程。

#### Scenario: 字幕硬烧到视频
- GIVEN 用户确认字幕内容
- When 选择「硬烧字幕」
- Then 使用 ffmpeg 将字幕烧录到视频中
- And 输出带字幕的视频文件

#### Scenario: 字幕作为发布元数据
- GIVEN 生成的字幕
- When 用户选择「作为描述发布」
- Then 将字幕文本填充到发布表单的描述字段
- And 支持字幕文本的二次编辑

#### Scenario: 字幕文件下载
- GIVEN 生成的字幕
- When 用户点击「下载字幕」
- Then 提供 SRT/ASS 格式下载

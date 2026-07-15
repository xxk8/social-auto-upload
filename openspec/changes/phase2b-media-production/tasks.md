## Phase 2b — 内容生产链

> 本子变更从父 umbrella `product-roadmap-2026q3` 摘录任务 16-23。共 35 个 checkbox。

### 16. 视频切片 — 依赖安装（Web API）

- [ ] 16.1 新增 `moviepy` 和 `scenedetect` 到 `pyproject.toml` 依赖
- [ ] 16.2 验证 `scenedetect` ContentDetector 在现有测试视频上的切点准确度

### 17. 视频切片 — 核心逻辑（Web API）

- [ ] 17.1 新增 `web_runner/routes/video_clip.py` 蓝图
- [ ] 17.2 实现 `_detect_scenes(video_path)` — 使用 scenedetect 检测场景切换点
- [ ] 17.3 实现 `_clip_video(video_path, scenes)` — 使用 moviepy 按切点裁剪
- [ ] 17.4 实现 `POST /api/video/clip` — 上传视频 → 检测场景 → 返回切片列表
- [ ] 17.5 实现 `POST /api/video/clip/manual` — 手动指定切点时间 → 执行切片
- [ ] 17.6 实现切片预览（返回各片段的时长/缩略图）

### 18. 视频切片 — 前端 UI（Frontend）

- [ ] 18.1 PublishPage 新增「视频切片」入口
- [ ] 18.2 实现视频上传 + 场景检测触发
- [ ] 18.3 实现切点列表展示（可拖拽调整）
- [ ] 18.4 实现切片预览播放
- [ ] 18.5 实现切片结果一键填充到发布表单

### 19. 自动字幕 — 依赖安装（Web API）

- [ ] 19.1 新增 `faster-whisper` 到 `pyproject.toml` 依赖
- [ ] 19.2 实现本地模型加载与磁盘缓存（**注**：父 design.md 提到的"复用 Inbox 的 Whisper 模型加载逻辑"不成立，`inbox.py` 当前调用 OpenAI API）

### 20. 自动字幕 — 核心逻辑（Web API）

- [ ] 20.1 新增 `web_runner/routes/subtitle.py` 蓝图
- [ ] 20.2 实现 `_extract_audio(video_path)` — 从视频提取音频（ffmpeg）
- [ ] 20.3 实现 `_generate_subtitle(audio_path)` — 使用 faster-whisper 生成 SRT
- [ ] 20.4 实现 `POST /api/subtitle/generate` — 上传视频 → 生成字幕 → 返回 SRT 文件
- [ ] 20.5 实现 `POST /api/subtitle/burn` — 字幕硬烧到视频（可选）

### 21. 自动字幕 — 前端 UI（Frontend）

- [ ] 21.1 PublishPage 新增「自动字幕」入口
- [ ] 21.2 实现字幕生成触发 + 进度展示
- [ ] 21.3 实现字幕预览（SRT 内容展示 + 时间轴对齐）
- [ ] 21.4 实现字幕编辑（用户可修正识别错误）
- [ ] 21.5 实现字幕应用到发布流程

### 22. 封面生成 — 核心逻辑（Web API）

- [ ] 22.1 新增 `web_runner/routes/thumbnail.py` 蓝图
- [ ] 22.2 实现 `_extract_best_frame(video_path)` — 使用 opencv 提取最佳帧
- [ ] 22.3 实现 `_add_text_overlay(image, text)` — 使用 Pillow 添加文字
- [ ] 22.4 实现 `_add_watermark(image, watermark)` — 使用 Pillow 添加水印
- [ ] 22.5 实现 `POST /api/thumbnail/generate` — 上传视频 → 自动生成封面
- [ ] 22.6 实现 `POST /api/thumbnail/batch-watermark` — 批量添加水印

### 23. 封面生成 — 前端 UI（Frontend）

- [ ] 23.1 PublishPage 新增「封面生成」入口
- [ ] 23.2 实现封面预览 + 文字编辑
- [ ] 23.3 实现水印上传 + 预览
- [ ] 23.4 实现批量水印操作界面

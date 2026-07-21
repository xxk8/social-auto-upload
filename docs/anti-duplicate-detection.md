# 视频/图片去重检测对抗指南

## 概述

本系统内置了**视频和图片指纹混淆引擎**，通过对媒体文件进行轻微的、人眼不可察觉的处理，改变文件的MD5、感知哈希、编码指纹等特征，从而对抗平台的内容重复检测机制。

## 已支持平台

| 平台 | 视频混淆 | 图片混淆 | 状态 |
|------|---------|---------|------|
| 抖音 | ✅ | ✅ | 已集成 |
| 小红书 | ✅ | ✅ | 已集成 |
| 快手 | ✅ | ✅ | 已集成 |
| B站 | ✅ | ✅ | **新增** |
| 百家号 | ✅ | ❌ | 已集成 |
| 视频号 | ✅ | ✅ | 已集成 |
| TikTok | ✅ | ✅ | 已集成 |
| YouTube | ✅ | ❌ | **新增** |

## 工作原理

### 对抗的检测机制

1. **MD5/SHA-256 哈希** → 通过重新编码彻底改变
2. **感知哈希（pHash/dHash）** → 通过裁剪+噪点+亮度调整破坏
3. **帧级特征提取** → 通过编码参数随机化干扰
4. **元数据指纹** → 通过 `-map_metadata -1` 完全剥离
5. **编码指纹** → 通过比特率、GOP、像素格式变化

### 混淆技术

#### 视频混淆
- **像素裁剪**：移除1-4像素边缘（视觉不可见但改变哈希）
- **比特率随机化**：±5%到±15%变化（可配置）
- **微噪点注入**：`noise=alls=1:allf=t+u`（人眼无法察觉）
- **亮度/对比度微调**：±1%到±3%变化
- **重新编码**：libx264，随机GOP大小
- **音频重新编码**：AAC，随机比特率
- **元数据完全剥离**：EXIF、XMP、编码器标签

#### 图片混淆
- **像素裁剪**：移除1-2像素边缘
- **质量微调**：±3变化
- **亮度微调**：±1%变化
- **元数据剥离**

## 使用方法

### 自动启用（默认）

所有已集成平台在**上传时会自动调用混淆**，无需额外配置：

```python
# 抖音 - 已集成
from uploader.douyin_uploader.main import DouYinVideo
video = DouYinVideo(title="标题", file_path="video.mp4", ...)
# 上传前自动混淆

# 快手 - 已集成
from uploader.ks_uploader.main import KSVideo
video = KSVideo(title="标题", file_path="video.mp4", ...)
# 上传前自动混淆

# 小红书 - 已集成
from uploader.xiaohongshu_uploader.main import XiaoHongShuVideo
video = XiaoHongShuVideo(title="标题", file_path="video.mp4", ...)
# 上传前自动混淆
```

### 手动调用 API

```python
from utils.anti_detect.content_fingerprint import obfuscate_video, obfuscate_image

# 视频混淆
obfuscated = obfuscate_video(
    "input.mp4",
    "output.mp4",
    crop_pixels=2,           # 裁剪2像素
    bitrate_variation=0.08,  # 比特率变化±8%
    add_noise=True,          # 添加噪点
    target_codec="libx264"   # 重新编码
)

# 图片混淆
obfuscated = obfuscate_image(
    "input.jpg",
    "output.jpg",
    quality=92,      # 质量
    crop_pixels=1    # 裁剪1像素
)
```

### 使用预设配置

```python
from utils.anti_detect.config import get_config, list_presets

# 查看所有可用预设
presets = list_presets()
print(presets)  # ['default', 'conservative', 'aggressive', 'fast', 'douyin', 'xiaohongshu', 'kuaishou', 'bilibili', 'baijiahao', 'tencent', 'tiktok', 'youtube']

# 获取特定平台配置
config = get_config("kuaishou")  # 快手专用配置

# 使用配置
obfuscated = obfuscate_video(
    "input.mp4",
    "output.mp4",
    crop_pixels=config.crop_pixels,
    bitrate_variation=config.bitrate_variation,
    add_noise=config.add_noise,
    target_codec=config.target_codec,
)
```

## 配置参数

### 预设配置说明

| 预设 | 适用场景 | 特点 |
|------|---------|------|
| `default` | 通用场景 | 平衡质量和去重效果 |
| `conservative` | 高质量要求 | 最轻微改动，最大化质量保留 |
| `aggressive` | 严格检测 | 最大去重效果，可能有质量损失 |
| `fast` | 批量处理 | 快速处理，跳过重新编码 |
| `douyin` | 抖音平台 | 已测试验证的配置 |
| `xiaohongshu` | 小红书平台 | 已测试验证的配置 |
| `kuaishou` | 快手平台 | 检测更严格，增加变化 |
| `bilibili` | B站平台 | 标准配置 |
| `baijiahao` | 百家号平台 | 标准配置 |
| `tencent` | 视频号平台 | 标准配置 |

### 自定义配置

创建自定义混淆配置：

```python
from utils.anti_detect.config import ObfuscationConfig

# 自定义配置
custom_config = ObfuscationConfig(
    crop_pixels=3,              # 裁剪3像素
    bitrate_variation=0.12,     # 比特率变化±12%
    add_noise=True,             # 添加噪点
    brightness_range=0.03,      # 亮度调整±3%
    contrast_range=0.03,        # 对比度调整±3%
    target_codec="libx264",     # 使用libx264
    image_quality=88,           # 图片质量88
    image_crop_pixels=2,        # 图片裁剪2像素
    min_bitrate_mbps=0.8,       # 最低比特率0.8Mbps
)

# 使用自定义配置
obfuscated = obfuscate_video(
    "input.mp4",
    "output.mp4",
    crop_pixels=custom_config.crop_pixels,
    bitrate_variation=custom_config.bitrate_variation,
    add_noise=custom_config.add_noise,
    target_codec=custom_config.target_codec,
    brightness_range=custom_config.brightness_range,
    contrast_range=custom_config.contrast_range,
    min_bitrate_mbps=custom_config.min_bitrate_mbps,
)
```

### 参数说明

#### 视频参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `crop_pixels` | int | 2 | 裁剪像素数 (1-4)，2像素在1080p下不可见但改变哈希 |
| `bitrate_variation` | float | 0.08 | 比特率变化幅度 (0.05-0.15) |
| `add_noise` | bool | True | 是否添加噪点 |
| `brightness_range` | float | 0.02 | 亮度调整范围 (±) |
| `contrast_range` | float | 0.02 | 对比度调整范围 (±) |
| `target_codec` | str | "libx264" | 编码器：libx264/libx265/copy |
| `min_bitrate_mbps` | float | 1.0 | 最低比特率(Mbps) |
| `fast_mode` | bool | False | 快速模式（跳过重新编码） |

#### 图片参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `quality` | int | 92 | JPEG/WebP质量 (75-100) |
| `crop_pixels` | int | 1 | 裁剪像素数 (1-2) |
| `brightness_range` | float | 0.01 | 亮度调整范围 (±) |

## 系统要求

### 依赖 ffmpeg

混淆功能依赖 ffmpeg 进行视频/图片处理：

```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg

# Windows (使用 Chocolatey)
choco install ffmpeg

# 验证安装
ffmpeg -version
```

### 检查 ffmpeg 可用性

```python
from utils.anti_detect.content_fingerprint import is_ffmpeg_available

if is_ffmpeg_available():
    print("ffmpeg 可用，混淆功能正常")
else:
    print("ffmpeg 未安装，将使用简单复制（仅改变元数据）")
```

## 性能考虑

### 处理时间

| 视频分辨率 | 平均处理时间 | 说明 |
|-----------|-------------|------|
| 720p | 10-20秒 | 快速处理 |
| 1080p | 20-40秒 | 标准处理 |
| 2K | 40-80秒 | 较长处理 |
| 4K | 80-160秒 | 非常长处理 |

### 快速模式

对于批量任务，可以使用快速模式（`fast_mode=True`）：
- 跳过噪点过滤
- 使用 `copy` 编码（不重新编码视频流）
- 仅改变元数据和裁剪
- 处理速度提升 5-10 倍

```python
from utils.anti_detect.config import get_config

config = get_config("fast")
# 处理时间缩短，但去重效果稍弱
```

### 文件大小

混淆后的文件大小变化：
- **视频**：±5%到±15%（取决于比特率变化）
- **图片**：±3%到±8%（取决于质量设置）

## 最佳实践

### 1. 选择合适的预设

```python
# 高质量要求 → conservative
config = get_config("conservative")

# 平台检测严格 → aggressive
config = get_config("aggressive")

# 批量处理 → fast
config = get_config("fast")
```

### 2. 测试可视化差异

建议先用保守参数测试，确认视觉无差异：

```python
from utils.anti_detect import obfuscate_video

# 先用保守参数测试
obfuscate_video(
    "input.mp4",
    "test_output.mp4",
    crop_pixels=1,
    bitrate_variation=0.05,
    add_noise=False,
    brightness_range=0.01,
    contrast_range=0.01,
)

# 人工检查测试视频，确认无差异后使用标准参数
```

### 3. 批量处理优化

```python
# 对于批量任务，使用 fast 模式
from utils.anti_detect.config import get_config
from utils.anti_detect import obfuscate_video
from pathlib import Path

config = get_config("fast")
video_dir = Path("videos/")
for video_file in video_dir.glob("*.mp4"):
    obfuscate_video(
        video_file,
        video_file.with_suffix(".obf.mp4"),
        crop_pixels=config.crop_pixels,
        bitrate_variation=config.bitrate_variation,
        add_noise=config.add_noise,
        target_codec=config.target_codec,
        fast_mode=config.fast_mode,
    )
```

### 4. 清理混淆文件

混淆会生成 `.obf.mp4` 等文件，建议定期清理：

```python
import os
from pathlib import Path

# 清理混淆文件
for obf_file in Path("videos/").glob("*.obf.mp4"):
    obf_file.unlink()
```

## 故障排查

### ffmpeg 未安装

**症状**：日志显示 `ffmpeg not found; falling back to copy`

**解决**：
```bash
# 安装 ffmpeg
brew install ffmpeg  # macOS
sudo apt install ffmpeg  # Ubuntu/Debian
```

### 处理速度慢

**症状**：视频处理时间过长

**解决**：
1. 使用快速模式：`config = get_config("fast")`
2. 减少裁剪像素：`crop_pixels=1`
3. 关闭噪点：`add_noise=False`

### 文件质量下降

**症状**：混淆后视频质量明显下降

**解决**：
1. 使用保守配置：`config = get_config("conservative")`
2. 提高比特率下限：`min_bitrate_mbps=2.0`
3. 减少亮度/对比度调整：`brightness_range=0.01, contrast_range=0.01`

## 技术细节

### 视频混淆流程

```
输入视频
  ↓
1. 提取原始比特率
  ↓
2. 随机化比特率 (±bitrate_variation)
  ↓
3. 构建滤镜图：
   - crop (裁剪像素)
   - scale+pad (恢复分辨率)
   - noise (可选噪点)
   - eq (亮度/对比度调整)
  ↓
4. 重新编码（或 copy）
  ↓
5. 重新编码音频（AAC，随机比特率）
  ↓
6. 剥离元数据
  ↓
输出视频
```

### 图片混淆流程

```
输入图片
  ↓
1. 随机质量 (±3)
  ↓
2. 构建滤镜图：
   - crop (裁剪像素)
   - eq (亮度调整)
  ↓
3. 重新编码（JPEG/WebP）
  ↓
4. 剥离元数据
  ↓
输出图片
```

## 扩展：为新平台添加混淆

在对应 uploader 的 `validate_upload_args` 中添加：

```python
from utils.anti_detect import obfuscate_video
from utils.anti_detect.config import get_config

async def validate_upload_args(self):
    # ... 现有验证代码 ...
    
    # 添加混淆
    config = get_config("your_platform")
    obf_path = str(Path(self.file_path).with_suffix("")) + ".obf" + Path(self.file_path).suffix
    obfuscated = obfuscate_video(
        self.file_path, 
        obf_path,
        crop_pixels=config.crop_pixels,
        bitrate_variation=config.bitrate_variation,
        add_noise=config.add_noise,
        target_codec=config.target_codec,
        brightness_range=config.brightness_range,
        contrast_range=config.contrast_range,
        min_bitrate_mbps=config.min_bitrate_mbps,
        fast_mode=config.fast_mode,
    )
    if obfuscated.exists():
        self.file_path = str(obfuscated)
        # 记录日志
        your_logger.info("视频指纹已混淆")
```

并在 `config.py` 中添加平台预设：

```python
PRESET_CONFIGS["your_platform"] = ObfuscationConfig(
    crop_pixels=2,
    bitrate_variation=0.08,
    add_noise=True,
    brightness_range=0.02,
    contrast_range=0.02,
    target_codec="libx264",
    image_quality=92,
    image_crop_pixels=1,
)
```

## 常见问题

### Q: 混淆会被平台检测到吗？

A: 本方案使用的混淆技术都是**人眼不可察觉**的微调，平台的反爬系统无法识别。已在实际使用中验证对抖音、小红书等平台有效。

### Q: 混淆后的视频质量会下降吗？

A: 使用默认参数时，质量损失**几乎不可察觉**。如果对质量有严格要求，可以使用 `conservative` 预设或调整参数。

### Q: 可以完全避免重复检测吗？

A: 没有绝对的保证，但本方案已实现**最大化的去重效果**。建议配合其他策略（如不同发布时间、不同标题等）使用。

### Q: 混淆需要多长时间？

A: 取决于视频分辨率和长度：
- 1080p 1分钟视频：约20-30秒
- 1080p 5分钟视频：约1-2分钟
- 使用快速模式可提速5-10倍

### Q: 混淆文件会占用额外空间吗？

A: 是的，每个上传的视频会生成一个 `.obf.mp4` 文件。建议上传完成后清理，或定期删除混淆文件。

## 相关文件

- `utils/anti_detect/content_fingerprint.py` - 核心混淆引擎
- `utils/anti_detect/config.py` - 配置系统
- `utils/anti_detect/__init__.py` - 模块导出
- `uploader/*/main.py` - 各平台集成代码

## 更新日志

### 2026-01-04
- 为快手、B站（图文）、百家号、视频号、TikTok添加混淆功能
- 创建可配置的混淆参数系统（10种预设）
- 预设配置：default/conservative/aggressive/fast/douyin/xiaohongshu/kuaishou/bilibili/baijiahao/tencent/tiktok
- 优化视频/图片混淆参数，支持自定义亮度/对比度/比特率范围
- 新增快速模式（fast_mode）用于批量处理
- TikTok采用更严格的参数（bitrate_variation=0.10），对抗平台严格检测

### 更早
- 抖音、小红书已集成混淆功能
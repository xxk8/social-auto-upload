"""可配置的混淆参数系统

为不同平台提供优化过的混淆策略，平衡去重效果和文件质量。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass
class ObfuscationConfig:
    """视频/图片混淆参数配置"""

    # 视频混淆
    crop_pixels: int = 2                    # 裁剪像素数 (1-4)
    bitrate_variation: float = 0.08         # 比特率变化幅度 (0.05-0.15)
    add_noise: bool = True                  # 是否添加噪点
    brightness_range: float = 0.02          # 亮度调整范围 (±)
    contrast_range: float = 0.02            # 对比度调整范围 (±)
    target_codec: Literal["libx264", "libx265", "copy"] = "libx264"

    # 图片混淆
    image_quality: int = 92                 # 图片质量 (75-100)
    image_crop_pixels: int = 1              # 图片裁剪像素数

    # 质量控制
    min_bitrate_mbps: float = 1.0           # 最低比特率
    preserve_quality: bool = True           # 保留高质量（仅轻微调整）
    fast_mode: bool = False                 # 快速模式（更快但效果稍弱）

    def to_dict(self) -> dict:
        """转换为字典，便于序列化"""
        return {
            "crop_pixels": self.crop_pixels,
            "bitrate_variation": self.bitrate_variation,
            "add_noise": self.add_noise,
            "brightness_range": self.brightness_range,
            "contrast_range": self.contrast_range,
            "target_codec": self.target_codec,
            "image_quality": self.image_quality,
            "image_crop_pixels": self.image_crop_pixels,
            "min_bitrate_mbps": self.min_bitrate_mbps,
            "preserve_quality": self.preserve_quality,
            "fast_mode": self.fast_mode,
        }

    @classmethod
    def from_dict(cls, data: dict) -> ObfuscationConfig:
        """从字典创建配置"""
        return cls(**data)


# 预设配置：不同平台优化策略
PRESET_CONFIGS: dict[str, ObfuscationConfig] = {
    # 默认：平衡质量和去重效果
    "default": ObfuscationConfig(
        crop_pixels=2,
        bitrate_variation=0.08,
        add_noise=True,
        brightness_range=0.02,
        contrast_range=0.02,
        target_codec="libx264",
        image_quality=92,
        image_crop_pixels=1,
    ),

    # 保守：最轻微的改动，最大化质量保留
    "conservative": ObfuscationConfig(
        crop_pixels=1,
        bitrate_variation=0.05,
        add_noise=False,
        brightness_range=0.01,
        contrast_range=0.01,
        target_codec="libx264",
        image_quality=95,
        image_crop_pixels=1,
        min_bitrate_mbps=2.0,
        preserve_quality=True,
    ),

    # 激进：最大去重效果（ noticeable quality loss）
    "aggressive": ObfuscationConfig(
        crop_pixels=3,
        bitrate_variation=0.12,
        add_noise=True,
        brightness_range=0.03,
        contrast_range=0.03,
        target_codec="libx264",
        image_quality=88,
        image_crop_pixels=2,
        min_bitrate_mbps=0.8,
    ),

    # 快速：快速处理，适合批量任务
    "fast": ObfuscationConfig(
        crop_pixels=2,
        bitrate_variation=0.08,
        add_noise=False,  # 跳过噪点以加速
        brightness_range=0.02,
        contrast_range=0.02,
        target_codec="copy",  # 避免重新编码以加速
        image_quality=90,
        image_crop_pixels=1,
        fast_mode=True,
    ),

    # 平台专属：抖音（已测试验证）
    "douyin": ObfuscationConfig(
        crop_pixels=2,
        bitrate_variation=0.08,
        add_noise=True,
        brightness_range=0.02,
        contrast_range=0.02,
        target_codec="libx264",
        image_quality=92,
        image_crop_pixels=1,
    ),

    # 平台专属：小红书
    "xiaohongshu": ObfuscationConfig(
        crop_pixels=2,
        bitrate_variation=0.08,
        add_noise=True,
        brightness_range=0.02,
        contrast_range=0.02,
        target_codec="libx264",
        image_quality=92,
        image_crop_pixels=1,
    ),

    # 平台专属：快手
    "kuaishou": ObfuscationConfig(
        crop_pixels=2,
        bitrate_variation=0.10,  # 快手检测更严格，增加变化
        add_noise=True,
        brightness_range=0.02,
        contrast_range=0.02,
        target_codec="libx264",
        image_quality=91,
        image_crop_pixels=1,
    ),

    # 平台专属：B站
    "bilibili": ObfuscationConfig(
        crop_pixels=2,
        bitrate_variation=0.08,
        add_noise=True,
        brightness_range=0.02,
        contrast_range=0.02,
        target_codec="libx264",
        image_quality=92,
        image_crop_pixels=1,
    ),

    # 平台专属：百家号
    "baijiahao": ObfuscationConfig(
        crop_pixels=2,
        bitrate_variation=0.08,
        add_noise=True,
        brightness_range=0.02,
        contrast_range=0.02,
        target_codec="libx264",
        image_quality=92,
        image_crop_pixels=1,
    ),

    # 平台专属：视频号
    "tencent": ObfuscationConfig(
        crop_pixels=2,
        bitrate_variation=0.08,
        add_noise=True,
        brightness_range=0.02,
        contrast_range=0.02,
        target_codec="libx264",
        image_quality=92,
        image_crop_pixels=1,
    ),

    # 平台专属：TikTok
    "tiktok": ObfuscationConfig(
        crop_pixels=2,
        bitrate_variation=0.10,  # TikTok检测严格，增加变化
        add_noise=True,
        brightness_range=0.02,
        contrast_range=0.02,
        target_codec="libx264",
        image_quality=91,
        image_crop_pixels=1,
    ),

    # 平台专属：YouTube
    "youtube": ObfuscationConfig(
        crop_pixels=2,
        bitrate_variation=0.08,
        add_noise=True,
        brightness_range=0.02,
        contrast_range=0.02,
        target_codec="libx264",
        image_quality=92,
        image_crop_pixels=1,
    ),
}


def get_config(preset: str = "default") -> ObfuscationConfig:
    """获取指定预设配置

    Args:
        preset: 预设名称 (default, conservative, aggressive, fast, douyin, xiaohongshu, kuaishou, bilibili)

    Returns:
        ObfuscationConfig 实例
    """
    return PRESET_CONFIGS.get(preset, PRESET_CONFIGS["default"])


def list_presets() -> list[str]:
    """列出所有可用的预设配置"""
    return list(PRESET_CONFIGS.keys())

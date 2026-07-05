import base64
import sys
from datetime import datetime
from pathlib import Path

import cv2
import segno


def build_login_qrcode_path(account_file: str, suffix: str = "login_qrcode") -> Path:
    account_path = Path(account_file)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return account_path.with_name(f"{account_path.stem}_{suffix}_{timestamp}.png")


def save_data_url_image(data_url: str, output_path: Path) -> Path:
    if not data_url.startswith("data:image/"):
        raise ValueError("二维码地址不是 data:image 格式")

    header, encoded = data_url.split(",", 1)
    if ";base64" not in header:
        raise ValueError("二维码图片不是 base64 编码")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(base64.b64decode(encoded))
    return output_path


def remove_qrcode_file(qrcode_path: Path | None) -> bool:
    if qrcode_path and qrcode_path.exists():
        qrcode_path.unlink()
        return True
    return False


def decode_qrcode_from_path(qrcode_path: Path) -> str | None:
    """Decode a QR code PNG with a two-layer fallback.

    Tries in order:
      1. OpenCV ``QRCodeDetector`` (zxing wrapped) — fast, bundled, works
         on clean QRs.
      2. ``pyzbar`` — different algorithm, more tolerant of cropped / scaled
         / partly-occluded QRs. Requires ``libzbar`` system library; if
         absent the import is silently skipped (no-op fallback).

    Returns the decoded payload string if either decoder succeeds, else
    ``None``. Callers MUST treat ``None`` as "do not try to render ASCII
    on the terminal" and just surface the PNG path to the user — the
    PNG itself is the authoritative artifact.
    """
    image = cv2.imread(str(qrcode_path))
    if image is None:
        return None

    # Primary: zxing wrapped in OpenCV
    detector = cv2.QRCodeDetector()
    qrcode_content, _, _ = detector.detectAndDecode(image)
    if qrcode_content:
        return qrcode_content

    # Fallback: pyzbar. Catches QRs that cv2 misses (e.g. screenshot
    # has extra chrome padding around the QR, or low contrast).
    # pyzbar raises ImportError if libzbar system lib is missing — we
    # silently degrade to zxing-only rather than crash the login flow.
    #
    # Color-space note: cv2.imread returns BGR; pyzbar's underlying
    # zbar scanner only reads grayscale. We convert to single-channel
    # gray before handing it off — this avoids the BGR-vs-RGB channel
    # swap ambiguity that bites BGR→RGB conversion paths, and matches
    # what zbar natively expects. QR codes are B&W anyway, so we lose
    # nothing.
    try:
        from pyzbar.pyzbar import decode as _pyzbar_decode
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        decoded = _pyzbar_decode(gray)
        if decoded:
            return decoded[0].data.decode("utf-8", errors="replace")
    except ImportError:
        # libzbar not installed; common on macOS without `brew install zbar`.
        # Silent no-op so the login flow still works (just no fallback).
        pass
    except Exception:
        # Decoder-level error (corrupt JPEG, RGBA mismatch, etc.) — don't
        # surface to user, the PNG path is what matters.
        pass

    return None


def _print_ascii_qrcode(qrcode) -> None:
    border = 1
    rows = list(qrcode.matrix)
    empty_line = "  " * (len(rows[0]) + border * 2)
    print(empty_line)
    for row in rows:
        line = ["  "] * border
        line.extend("##" if cell else "  " for cell in row)
        line.extend(["  "] * border)
        print("".join(line))
    print(empty_line)


def print_terminal_qrcode(
    qrcode_content: str,
    qrcode_path: Path,
    app_name: str,
    compact: bool = True,
    border: int = 0,
) -> None:
    print()
    print(f"请使用{app_name}扫描下方二维码登录：")
    qrcode = segno.make(qrcode_content, error="L", boost_error=False)
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
        qrcode.terminal(compact=compact, border=border)
    except (UnicodeEncodeError, OSError):
        print("当前终端不支持 Unicode 二维码字符，已切换为 ASCII 打印：")
        _print_ascii_qrcode(qrcode)
    print("在 Windows 下建议使用 Windows Terminal（支持 UTF-8，可完整显示二维码）")
    print(f"否则请打开 {qrcode_path} 扫码")
    print()

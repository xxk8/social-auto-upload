"""decode_qrcode_from_path zxing→pyzbar fallback chain contract.

Pins the two-layer fallback behavior added for Strategy 3 (zxing-first,
pyzbar-fallback, PNG-path-on-both-fail) so a refactor can't silently:
  * swap the decoder order
  * regress the ImportError silent-degrade path when libzbar is missing on host
  * regress the broad-Exception safety net inside the pyzbar branch
  * regress the cv2.imread None early-exit guard

All tests use mocked cv2 / pyzbar — no real PNGs needed, so the suite stays
deterministic on hosts where libzbar isn't installed (common on macOS
without ``brew install zbar``).
"""

import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock

import numpy as np
import pytest

from utils.login_qrcode import decode_qrcode_from_path

# ── Fixtures ──────────────────────────────────────────────────────────────


@pytest.fixture
def fake_qr_ndarray() -> np.ndarray:
    """Toy BGR ndarray — pixel values are irrelevant; we mock the decoders.

    10x10x3 keeps the array "well-formed enough" for cv2's mock surface
    to not complain; the actual decoding is fully controlled by the
    cv2.QRCodeDetector and pyzbar mocks below.
    """
    return np.zeros((10, 10, 3), dtype=np.uint8)


@pytest.fixture
def tmp_qr_path(tmp_path: Path) -> Path:
    """Path to a non-existent file — cv2.imread is fully mocked, so the
    file itself does not need to exist on disk."""
    return tmp_path / "login_qrcode.png"


@pytest.fixture
def mock_cv2(monkeypatch, fake_qr_ndarray):
    """Replace ``cv2.imread`` / ``cv2.QRCodeDetector`` / ``cv2.cvtColor``
    with controllable mocks.

    Returns a SimpleNamespace so individual tests can override the
    specific behaviors (zxing return value, pyzbar return value) they
    want to test, and assert side-effects (e.g., ``cvtColor`` was
    called once for the grayscale branch).
    """
    mock_imread = MagicMock(return_value=fake_qr_ndarray)
    mock_cvtColor = MagicMock(return_value=fake_qr_ndarray)
    mock_detector = MagicMock()
    # Default: zxing fails (returns (empty_str, None, None)).
    mock_detector.detectAndDecode.return_value = ("", None, None)

    monkeypatch.setattr("cv2.imread", mock_imread)
    monkeypatch.setattr("cv2.QRCodeDetector", lambda: mock_detector)
    monkeypatch.setattr("cv2.cvtColor", mock_cvtColor)

    return SimpleNamespace(
        imread=mock_imread,
        detector=mock_detector,
        cvtColor=mock_cvtColor,
    )


@pytest.fixture
def fake_pyzbar(monkeypatch):
    """Install a fake ``pyzbar`` package into ``sys.modules`` so the
    inline ``from pyzbar.pyzbar import decode as _pyzbar_decode`` in
    ``decode_qrcode_from_path`` resolves to our controllable mock
    instead of touching the real libzbar.

    Default ``decode.return_value = []`` (treat as "no QR detected" —
    zxing-fails + pyzbar-empty-list branch). Tests override per case
    via ``fake_pyzbar.decode.return_value = [...]``.

    Implementation notes:
      * Both ``sys.modules['pyzbar']`` AND ``sys.modules['pyzbar.pyzbar']``
        are explicitly set. Python's import machinery for
        ``from X.Y import Z`` may, depending on internal walk order,
        lookup the dotted name directly (and require the entry) OR
        walk parent attributes (and find ``fake_pkg.pzbar``). Setting
        both eliminates the auto-traversal dependency.
      * ``types.ModuleType`` (real module instances) is used instead
        of MagicMock. Python's import machinery expects real module
        metadata (``__name__``, ``__spec__``) on attempted imports;
        MagicMock-without-spec occasionally trips internal
        ``hasattr`` introspection in ``__import__``. ModuleType
        removes the magic entirely.
    """
    fake_pkg = ModuleType("pyzbar")
    fake_inner = ModuleType("pyzbar.pyzbar")
    decode_mock = MagicMock(return_value=[])
    fake_inner.decode = decode_mock
    fake_pkg.pyzbar = fake_inner
    monkeypatch.setitem(sys.modules, "pyzbar", fake_pkg)
    monkeypatch.setitem(sys.modules, "pyzbar.pyzbar", fake_inner)
    return SimpleNamespace(pkg=fake_pkg, inner=fake_inner, decode=decode_mock)


@pytest.fixture
def force_pyzbar_import_error(monkeypatch):
    """Force ``from pyzbar.pyzbar import decode`` to raise ImportError,
    simulating the libzbar-missing-on-host state.

    Canonical Python pattern: setting ``sys.modules['pyzbar'] = None``
    causes any subsequent ``import pyzbar`` (including inline
    ``from pyzbar.pyzbar import decode``) to raise
    ``ImportError("...halted; None in sys.modules")``. We also wipe any
    pre-existing ``pyzbar.*`` cache so the inline import actually
    re-runs instead of using a previously-resolved module.
    """
    for key in list(sys.modules):
        if key == "pyzbar" or key.startswith("pyzbar."):
            monkeypatch.delitem(sys.modules, key)
    monkeypatch.setitem(sys.modules, "pyzbar", None)


# ── Tests ─────────────────────────────────────────────────────────────────


class TestZxingIsPrimary:
    """The OpenCV zxing decoder runs first; if it returns a payload
    the function exits without ever touching pyzbar."""

    def test_returns_zxing_payload_without_touching_pyzbar(self, mock_cv2, tmp_qr_path):
        payload = "https://api.amemv.com/ucenter_web/app/aweme/scan_login/v/"
        mock_cv2.detector.detectAndDecode.return_value = (payload, None, None)

        result = decode_qrcode_from_path(tmp_qr_path)

        assert result == payload
        # zxing short-circuited the function: pyzbar was never imported
        # (early `if qrcode_content: return qrcode_content` exit guard).
        assert "pyzbar" not in sys.modules, "zxing success path must NOT import pyzbar (early return guard)"
        # cvtColor was also never reached (no grayscale branch entered).
        mock_cv2.cvtColor.assert_not_called()


class TestPyzbarFallback:
    """When zxing returns empty / None, the function falls back to pyzbar."""

    def test_returns_pyzbar_payload_when_zxing_fails(self, mock_cv2, fake_pyzbar, tmp_qr_path):
        mock_cv2.detector.detectAndDecode.return_value = ("", None, None)
        payload = "https://www.douyin.com/login/qr"
        fake_pyzbar.decode.return_value = [
            SimpleNamespace(data=payload.encode("utf-8")),
        ]

        result = decode_qrcode_from_path(tmp_qr_path)

        assert result == payload
        # cvtColor was called to produce the grayscale buffer for pyzbar.
        mock_cv2.cvtColor.assert_called_once()
        # pyzbar.decode was called with the cvtColor output (grayscale).
        fake_pyzbar.decode.assert_called_once_with(mock_cv2.cvtColor.return_value)

    def test_decodes_pyzbar_bytes_with_utf8(self, mock_cv2, fake_pyzbar, tmp_qr_path):
        """Pins the ``decoded[0].data.decode("utf-8", errors="replace")``
        step: real pyzbar returns ``data`` as ``bytes``, function must
        UTF-8 decode it back to ``str``. Non-ASCII content verifies the
        encoding step actually runs (not just str-pass-through)."""
        mock_cv2.detector.detectAndDecode.return_value = ("", None, None)
        # Non-ASCII URL fragment to prove the decode step is real.
        payload = "https://抖音.com/qr登录"
        fake_pyzbar.decode.return_value = [
            SimpleNamespace(data=payload.encode("utf-8")),
        ]

        result = decode_qrcode_from_path(tmp_qr_path)

        assert result == payload

    def test_survives_invalid_utf8_with_errors_replace(self, mock_cv2, fake_pyzbar, tmp_qr_path):
        """Pins the ``errors="replace"`` argument of the bytes→str
        decode step. Real pyzbar returns raw ``bytes``; if zbar scans
        a malformed/garbled image the data may include non-UTF-8 byte
        sequences. Without ``errors="replace"`` the function would
        raise UnicodeDecodeError; with it, the result is still a
        ``str`` (invalid bytes become U+FFFD REPLACEMENT CHARACTER
        chars)."""
        mock_cv2.detector.detectAndDecode.return_value = ("", None, None)
        # ``\xff\xfe`` are not valid UTF-8 start bytes — invalid under
        # the UTF-8 spec. With ``errors="replace"`` each invalid byte
        # becomes one U+FFFD; the valid surrounding bytes survive intact.
        fake_pyzbar.decode.return_value = [
            SimpleNamespace(data=b"validstart\xff\xfeinvalid"),
        ]

        result = decode_qrcode_from_path(tmp_qr_path)

        assert isinstance(result, str), "errors='replace' must yield a str even for invalid UTF-8"
        # Valid prefix is preserved end-to-end.
        assert result.startswith("validstart"), "Valid UTF-8 prefix must survive intact through errors='replace'"
        # Invalid bytes\nmap to U+FFFD (one replacement char per byte).
        assert "\ufffd" in result, "Invalid UTF-8 bytes must map to U+FFFD per errors='replace' contract"


class TestBothDecodersFail:
    """Both decoders fail → function returns ``None``. Caller pushes
    PNG path to user instead of attempting terminal ASCII render."""

    def test_returns_none_when_zxing_empty_and_pyzbar_empty_list(self, mock_cv2, fake_pyzbar, tmp_qr_path):
        mock_cv2.detector.detectAndDecode.return_value = ("", None, None)
        # fake_pyzbar.decode.return_value defaults to [] from fixture.
        result = decode_qrcode_from_path(tmp_qr_path)
        assert result is None

    def test_returns_none_when_pyzbar_module_unavailable(self, mock_cv2, force_pyzbar_import_error, tmp_qr_path):
        """Simulates libzbar missing on host (common on macOS without
        ``brew install zbar``). The inline ``from pyzbar.pyzbar import decode``
        raises ImportError; the function's ``except ImportError: pass``
        silently degrades to ``None``.
        """
        mock_cv2.detector.detectAndDecode.return_value = ("", None, None)

        result = decode_qrcode_from_path(tmp_qr_path)

        assert result is None
        # Source order pins this: inline pyzbar import happens BEFORE
        # cvtColor in the try block. When ImportError fires, control
        # jumps to ``except ImportError: pass`` and cvtColor is never
        # reached. If a future refactor reorders these, this assertion
        # pins the regression so it can be caught + flagged.
        assert mock_cv2.cvtColor.call_count == 0, "cvtColor must NOT be called when pyzbar ImportError fires first"

    def test_returns_none_when_pyzbar_decode_raises(self, mock_cv2, fake_pyzbar, tmp_qr_path):
        """A decoder-level error inside ``pyzbar.decode`` must be caught
        by the broad ``except Exception`` and degrade to ``None``. Pins
        the safety net so a regression that narrows the except
        (e.g., ``except ValueError:``) doesn't crash the login flow on
        a corrupt / weird-image decode."""
        mock_cv2.detector.detectAndDecode.return_value = ("", None, None)
        fake_pyzbar.decode.side_effect = ValueError("simulated zbar internal error")

        result = decode_qrcode_from_path(tmp_qr_path)

        assert result is None


class TestImreadFailure:
    """If ``cv2.imread`` returns ``None`` (file unreadable / wrong
    format), the function exits immediately without attempting either
    decoder."""

    def test_returns_none_when_image_cannot_be_read(self, mock_cv2, tmp_qr_path):
        mock_cv2.imread.return_value = None

        result = decode_qrcode_from_path(tmp_qr_path)

        assert result is None
        # Neither decoder ever ran (early-return guard after imread).
        mock_cv2.detector.detectAndDecode.assert_not_called()
        # pyzbar was never imported either (same early-return path).
        assert "pyzbar" not in sys.modules

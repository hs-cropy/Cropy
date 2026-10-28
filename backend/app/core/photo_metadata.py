"""Remove private metadata from stored JPEG/PNG photos without re-encoding.

Pixel data is copied byte for byte, so the model input stays identical. Only
the display orientation survives (as a minimal EXIF block). GPS, camera
identity, timestamps, XMP/IPTC, comments and anything appended after the image
(motion-photo videos, extra MPO pictures) are dropped.
"""
import struct

# APP2 is kept only for ICC profiles; APP0 (JFIF) and APP14 (Adobe colour
# transform) affect decoding. All other APPn and COM segments are dropped.
_KEEP_APP = {0xE0, 0xEE}
_STANDALONE = {0x01, *range(0xD0, 0xD8)}
# Ancillary PNG chunks that affect rendering; any other ancillary chunk
# (tEXt/zTXt/iTXt/eXIf/tIME/private) is dropped. Critical chunks are always kept.
_KEEP_PNG = {b"tRNS", b"gAMA", b"cHRM", b"sRGB", b"iCCP", b"sBIT", b"pHYs", b"bKGD", b"hIST",
             b"cICP", b"mDCv", b"cLLi", b"acTL", b"fcTL", b"fdAT"}
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def _orientation_exif(orientation: int | None) -> bytes:
    if orientation not in range(2, 9):
        return b""
    # Big-endian TIFF header + one IFD entry: Orientation (0x0112), SHORT, count 1.
    tiff = b"MM\x00\x2a" + struct.pack(">IH", 8, 1) + struct.pack(">HHIH2x", 0x0112, 3, 1, orientation) + b"\0" * 4
    payload = b"Exif\0\0" + tiff
    return b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload


def _scan_end(content: bytes, i: int) -> int:
    """Return the offset of the marker that ends entropy-coded data starting at i."""
    while True:
        i = content.index(b"\xff", i)
        following = content[i + 1]
        if following == 0x00 or 0xD0 <= following <= 0xD7 or following == 0xFF:
            i += 1 if following == 0xFF else 2
            continue
        return i


def strip_jpeg(content: bytes, orientation: int | None = None) -> bytes:
    if content[:2] != b"\xff\xd8":
        raise ValueError("not a JPEG")
    head: list[bytes] = []
    body: list[bytes] = []
    i = 2
    try:
        while True:
            if content[i] != 0xFF:
                raise ValueError("expected JPEG marker")
            while content[i] == 0xFF:
                i += 1
            marker = content[i]
            i += 1
            if marker == 0xD9:
                break  # Drop everything after the first image.
            if marker in _STANDALONE:
                body.append(bytes((0xFF, marker)))
                continue
            (length,) = struct.unpack(">H", content[i:i + 2])
            if length < 2 or i + length > len(content):
                raise ValueError("truncated JPEG segment")
            segment = content[i - 2:i + length]
            data = content[i + 2:i + length]
            i += length
            if marker == 0xDA:
                end = _scan_end(content, i)
                body.append(segment + content[i:end])
                i = end
            elif marker == 0xE2 and data.startswith(b"ICC_PROFILE\0"):
                body.append(segment)
            elif marker in _KEEP_APP:
                # JFIF APP0 must stay first; the rest keep their relative order.
                (head if marker == 0xE0 and not body else body).append(segment)
            elif 0xE0 <= marker <= 0xEF or marker == 0xFE:
                continue
            else:
                body.append(segment)
    except (IndexError, struct.error) as exc:
        raise ValueError("truncated JPEG") from exc
    return b"\xff\xd8" + b"".join(head) + _orientation_exif(orientation) + b"".join(body) + b"\xff\xd9"


def strip_png(content: bytes) -> bytes:
    if not content.startswith(_PNG_SIGNATURE):
        raise ValueError("not a PNG")
    chunks = [_PNG_SIGNATURE]
    i = len(_PNG_SIGNATURE)
    while True:
        if i + 8 > len(content):
            raise ValueError("truncated PNG")
        length, kind = struct.unpack(">I4s", content[i:i + 8])
        end = i + 12 + length
        if end > len(content):
            raise ValueError("truncated PNG chunk")
        if kind[0] & 0x20 == 0 or kind in _KEEP_PNG:  # uppercase first letter = critical
            chunks.append(content[i:end])
        i = end
        if kind == b"IEND":
            return b"".join(chunks)

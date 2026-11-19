#!/usr/bin/env python3
"""Extract the public signing certificate SHA-1 from a v2-signed Android APK.

This does not require the private key; apksigner must separately verify the APK.
"""
import hashlib
import struct
import sys
from pathlib import Path


def u32(buffer, pos):
    return struct.unpack_from("<I", buffer, pos)[0]


def u64(buffer, pos):
    return struct.unpack_from("<Q", buffer, pos)[0]


def lp(blob, pos):
    if pos + 4 > len(blob):
        raise ValueError("truncated length")
    length = u32(blob, pos)
    start, end = pos + 4, pos + 4 + length
    if end > len(blob):
        raise ValueError("truncated field")
    return blob[start:end], end


def signer_sha1(path):
    data = Path(path).read_bytes()
    end = data.rfind(b"PK\x05\x06")
    if end < 0 or end + 20 > len(data):
        raise ValueError("missing APK ZIP central directory")
    directory = u32(data, end + 16)
    if data[directory - 16:directory] != b"APK Sig Block 42":
        raise ValueError("missing APK Signing Block")
    size = u64(data, directory - 24)
    start = directory - size - 8
    if start < 0 or u64(data, start) != size:
        raise ValueError("invalid signing block size")
    pos = start + 8
    while pos < directory - 24:
        length = u64(data, pos)
        block_id = u32(data, pos + 8)
        value = data[pos + 12:pos + 8 + length]
        if block_id == 0x7109871A:
            signers, _ = lp(value, 0)
            signer, _ = lp(signers, 0)
            signed_data, _ = lp(signer, 0)
            _, next_pos = lp(signed_data, 0)   # digests
            certs, _ = lp(signed_data, next_pos)
            certificate, _ = lp(certs, 0)
            if not certificate:
                raise ValueError("empty public certificate")
            return hashlib.sha1(certificate).hexdigest()
        pos += 8 + length
    raise ValueError("APK v2 signer unavailable")


if __name__ == "__main__":
    print(signer_sha1(sys.argv[1]))

"""Short-lived, signed server-result snapshots; no browser-authored measurements."""

import base64
import hashlib
import hmac
import json
import secrets
import time
from functools import wraps

_KEY = secrets.token_bytes(32)  # Restart invalidates snapshots; never sent to the browser.
TTL = 21600


def compact(value):
    if isinstance(value, dict):
        return {
            k: compact(v)
            for k, v in value.items()
            if k
            not in {
                "profile",
                "source_record",
                "source_sha256",
                "chat_context",
                "region_shape",
            }
        }
    if isinstance(value, list):
        return [compact(v) for v in value]
    return value


def sign(kind, result):
    payload = json.dumps(
        {"kind": kind, "created_utc_epoch": int(time.time()), "data": compact(result)},
        allow_nan=False,
        separators=(",", ":"),
    ).encode()
    encoded = base64.urlsafe_b64encode(payload).decode()
    return encoded + "." + hmac.new(_KEY, encoded.encode(), hashlib.sha256).hexdigest()


def verify(token):
    try:
        if len(token) > 60000:
            raise ValueError("Oversize snapshot")
        encoded, signature = token.rsplit(".", 1)
        expected = hmac.new(_KEY, encoded.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError("Invalid signature")
        value = json.loads(base64.urlsafe_b64decode(encoded))
        if not 0 <= time.time() - value["created_utc_epoch"] <= TTL:
            raise ValueError("Expired snapshot")
        return value
    except (ValueError, KeyError, TypeError):
        return None


def capture(kind):
    def decorate(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            result = function(*args, **kwargs)
            return {**result, "chat_context": sign(kind, result)}

        return wrapped

    return decorate

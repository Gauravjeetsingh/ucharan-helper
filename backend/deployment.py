"""Explicit hosted-demo settings; normal local launches keep their existing policy."""
import re
from urllib.parse import urlsplit


def public_origin(value):
    if not value:
        return None
    parsed = urlsplit(value)
    if (parsed.scheme != 'https' or parsed.path or parsed.query or parsed.fragment
            or parsed.username or parsed.password or not parsed.hostname
            or parsed.netloc != parsed.hostname
            or not re.fullmatch(r'(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}', parsed.hostname)):
        raise ValueError('UCHAARAN_PUBLIC_ORIGIN must be https://your.domain with no port or path.')
    return value

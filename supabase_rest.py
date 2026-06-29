"""Tiny Supabase REST client for the data scripts (stdlib only — no pip deps).

Reads SUPABASE_URL + SUPABASE_SECRET_KEY from reporting-site/.env and provides
upsert / delete against the PostgREST API, so the Python exporters can write to
the same single-source-of-truth database the web app reads.

Best-effort by design: callers wrap these in try/except so a DB hiccup never
breaks the existing file outputs.
"""
import json
import os
import urllib.request
import urllib.error

_REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
_ENV_PATH = os.path.join(_REPO_ROOT, "reporting-site", ".env")


def _load_env():
    cfg = {}
    try:
        with open(_ENV_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                cfg[k.strip()] = v.strip()
    except FileNotFoundError:
        pass
    return cfg


_ENV = _load_env()
URL = _ENV.get("SUPABASE_URL", "").rstrip("/")
KEY = _ENV.get("SUPABASE_SECRET_KEY", "")


def configured() -> bool:
    return bool(URL and KEY)


def _request(method: str, path: str, params=None, body=None, prefer=None):
    if not configured():
        raise RuntimeError("Supabase not configured (SUPABASE_URL / SUPABASE_SECRET_KEY missing in reporting-site/.env)")
    qs = ""
    if params:
        qs = "?" + "&".join(f"{k}={urllib.parse.quote(str(v), safe='')}" for k, v in params.items())
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(f"{URL}/rest/v1/{path}{qs}", data=data, method=method)
    req.add_header("apikey", KEY)
    req.add_header("Authorization", f"Bearer {KEY}")
    req.add_header("Content-Type", "application/json")
    if prefer:
        req.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        raise RuntimeError(f"Supabase {method} {path} failed [{e.code}]: {detail}")


import urllib.parse  # noqa: E402  (after functions to keep header tidy)


def upsert(table: str, rows, on_conflict: str):
    """Insert or update rows, merging on the given conflict column(s)."""
    if not rows:
        return None
    return _request(
        "POST", table,
        params={"on_conflict": on_conflict},
        body=rows,
        prefer="resolution=merge-duplicates,return=minimal",
    )


def delete_eq(table: str, column: str, value: str):
    """Delete all rows where column == value."""
    return _request("DELETE", table, params={column: f"eq.{value}"}, prefer="return=minimal")

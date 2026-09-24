"""Probe all subscription feed URLs and report reachability.

Reads the JSON dump produced by:
  npx wrangler d1 execute <your-db-name> --remote --json \
    --command "SELECT id, title, url, fail_count, disabled FROM subscriptions"

Usage:
  python tools/check-feeds.py .tmp_subs.json
"""
import json
import sys
import concurrent.futures as cf
import urllib.request
import urllib.error
import ssl
import time
import socket

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
TIMEOUT = 20
FEED_HINTS = (b"<rss", b"<feed", b"<rdf", b"<channel", b"<?xml")


def probe(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    })
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as r:
            body = r.read(4096)
            ms = int((time.time() - t0) * 1000)
            ok = any(h in body.lower() for h in FEED_HINTS)
            return {
                "status": r.status,
                "ms": ms,
                "kind": "feed" if ok else "not-a-feed",
                "final": r.geturl(),
                "err": None,
            }
    except urllib.error.HTTPError as e:
        ms = int((time.time() - t0) * 1000)
        return {"status": e.code, "ms": ms, "kind": "http-error",
                "final": url, "err": f"HTTP {e.code} {e.reason}"}
    except (urllib.error.URLError, socket.timeout, ssl.SSLError, OSError) as e:
        ms = int((time.time() - t0) * 1000)
        reason = getattr(e, "reason", e)
        return {"status": None, "ms": ms, "kind": "unreachable",
                "final": url, "err": f"{type(reason).__name__}: {reason}"}


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else ".tmp_subs.json"
    raw = json.load(open(path, encoding="utf-8"))
    subs = raw[0]["results"] if isinstance(raw, list) else raw["results"]

    with cf.ThreadPoolExecutor(max_workers=12) as ex:
        results = list(ex.map(lambda s: (s, probe(s["url"])), subs))

    bad, warn, good = [], [], []
    for s, r in results:
        if r["kind"] in ("unreachable", "http-error"):
            bad.append((s, r))
        elif r["kind"] == "not-a-feed":
            warn.append((s, r))
        else:
            good.append((s, r))

    print(f"=== TOTAL {len(subs)} | OK {len(good)} | 异常 {len(bad)} | 可疑 {len(warn)} ===\n")

    def show(title, rows):
        if not rows:
            return
        print(f"--- {title} ({len(rows)}) ---")
        for s, r in rows:
            print(f"  [fail_count={s.get('fail_count', 0)}] {s['title']}")
            print(f"      {s['url']}")
            print(f"      -> status={r['status']} kind={r['kind']} {r['ms']}ms  {r['err'] or ''}")
        print()

    show("无法访问 / 异常", bad)
    show("内容不是 feed（可疑）", warn)
    print("--- 正常 ---")
    for s, r in sorted(good, key=lambda x: x[0]["title"]):
        print(f"  OK  {r['status']} {r['ms']:>5}ms  {s['title']}")


if __name__ == "__main__":
    main()

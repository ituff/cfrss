"""Run a matrix of User-Agent profiles against every subscription feed URL.

Detects the two failure classes that a single-UA fetcher cannot solve at once:
  * sites that reject a browser UA (403) but accept a generic one
  * sites that reject a generic UA (403) but accept a browser one
A URL is "split" when different profiles disagree on the outcome. Those are the
ones that need per-domain UA routing.

Usage (feed list is a JSON dump from wrangler d1 execute --json):
  python tools/probe-ua-split.py .tmp_subs.json
"""
import json
import sys
import ssl
import socket
import time
import urllib.request
import urllib.error
import concurrent.futures as cf

# (label, User-Agent) — kept in sync with src/services/content-fetcher.ts
PROFILES = [
    ("browser", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"),
    ("generic", "CFRSS/1.0 (+https://github.com/ituff/cfrss)"),
    ("feedreader", "FeedFetcher-Google; (+http://www.google.com/feedfetcher.html)"),
    ("curl", "curl/8.4.0"),
]
TIMEOUT = 15
ACCEPT = "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"


def probe(url, ua):
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": ACCEPT})
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as r:
            r.read(2048)
            return r.status, int((time.time() - t0) * 1000)
    except urllib.error.HTTPError as e:
        return e.code, int((time.time() - t0) * 1000)
    except (urllib.error.URLError, socket.timeout, ssl.SSLError, OSError):
        return 0, int((time.time() - t0) * 1000)


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else ".tmp_subs.json"
    raw = json.load(open(path, encoding="utf-8"))
    subs = raw[0]["results"] if isinstance(raw, list) else raw["results"]

    def run(sub):
        return sub, {label: probe(sub["url"], ua) for label, ua in PROFILES}

    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        rows = list(ex.map(run, subs))

    labels = [p[0] for p in PROFILES]
    print(f"{'title':<34} {' '.join(f'{l:>11}' for l in labels)}")
    print("-" * (34 + 12 * len(labels)))

    split, dead, agree_ok = [], [], 0
    for sub, res in sorted(rows, key=lambda x: x[0]["title"]):
        codes = [res[l][0] for l in labels]
        ok = [c == 200 for c in codes]
        cell = " ".join(f"{c if c else 'ERR':>11}" for c in codes)
        title = sub["title"][:33]
        if all(ok):
            agree_ok += 1
            print(f"{title:<34} {cell}")
        elif not any(ok):
            dead.append(sub)
            print(f"{title:<34} {cell}   <== 全部失败")
        else:
            split.append((sub, res))
            print(f"{title:<34} {cell}   <== 按 UA 分裂")

    print()
    print(f"全 UA 通过: {agree_ok}   按 UA 分裂: {len(split)}   全 UA 失败: {len(dead)}")
    if split:
        print("\n需要按域名分流 UA 的站点：")
        for sub, res in split:
            detail = "  ".join(f"{l}={res[l][0] or 'ERR'}" for l in labels)
            print(f"  - {sub['title']}  {sub['url']}\n      {detail}")
    if dead:
        print("\n任何 UA 都拉不到（站点级失效）：")
        for sub in dead:
            print(f"  - {sub['title']}  {sub['url']}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Build a static, deployable catalogue site from product.db + images/.

Output layout:
    site/data.json      joined catalogue data
    site/images/*       full-size photos
    site/thumb/*        thumbnails
    site/index.html ... hand-written shell (not touched by this script)

Media files are hard-linked into site/ when possible (no extra disk use),
falling back to a copy on filesystems that do not support hard links.
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
DB = ROOT / "product.db"
SITE = ROOT / "site"
TZ = ZoneInfo("Asia/Shanghai")


def rows(conn: sqlite3.Connection, sql: str) -> list[sqlite3.Row]:
    conn.row_factory = sqlite3.Row
    return conn.execute(sql).fetchall()


def sync_media(src: Path, dst: Path) -> int:
    """Mirror a media directory with hard links (copy as fallback)."""
    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True)
    count = 0
    for entry in sorted(src.iterdir()):
        if not entry.is_file() or entry.name.startswith("."):
            continue
        target = dst / entry.name
        try:
            os.link(entry, target)
        except OSError:
            shutil.copy2(entry, target)
        count += 1
    return count


def main() -> int:
    if not DB.is_file():
        print(f"error: {DB} not found", file=sys.stderr)
        return 1

    conn = sqlite3.connect(DB)
    styles = rows(conn, "SELECT sid, name FROM style ORDER BY sid")
    crafts = rows(conn, "SELECT cid, name, description FROM craft ORDER BY cid")
    themes = rows(conn, "SELECT gid, name, description FROM graph ORDER BY gid")
    products = rows(
        conn,
        """
        SELECT pid, name, image, sid, cid, gid, spec, price
        FROM product
        ORDER BY pid
        """,
    )
    conn.close()

    style_by_id = {r["sid"]: r for r in styles}
    craft_by_id = {r["cid"]: r for r in crafts}
    theme_by_id = {r["gid"]: r for r in themes}

    product_gids = {r["gid"] for r in products}
    theme_rows = [
        {
            "gid": r["gid"],
            "name": r["name"],
            "description": (r["description"] or "").strip(),
            "count": 0,
            "missing": False,
        }
        for r in themes
    ]
    # product.db references gid=1 but `graph` has no row for it.
    if 1 in product_gids and 1 not in theme_by_id:
        theme_rows.append(
            {
                "gid": 1,
                "name": "未归类",
                "description": "该作品纹样暂未归入具体题材。",
                "count": 0,
                "missing": True,
            }
        )
    theme_rows.sort(key=lambda t: (t["missing"], t["gid"]))
    theme_by_id = {t["gid"]: t for t in theme_rows}

    style_rows = [
        {"sid": r["sid"], "name": r["name"].strip(), "count": 0} for r in styles
    ]
    craft_rows = [
        {
            "cid": r["cid"],
            "name": r["name"].strip(),
            "description": (r["description"] or "").strip(),
            "count": 0,
        }
        for r in crafts
    ]

    style_count = {s["sid"]: s for s in style_rows}
    craft_count = {c["cid"]: c for c in craft_rows}

    out_products = []
    for p in products:
        style = style_by_id.get(p["sid"])
        craft = craft_by_id.get(p["cid"])
        theme = theme_by_id.get(p["gid"])
        if p["sid"] in style_count:
            style_count[p["sid"]]["count"] += 1
        if p["cid"] in craft_count:
            craft_count[p["cid"]]["count"] += 1
        if theme:
            theme["count"] += 1
        out_products.append(
            {
                "pid": p["pid"],
                "name": (p["name"] or "").strip(),
                "image": p["image"],
                "sid": p["sid"],
                "style": style["name"].strip() if style else "未分类器型",
                "cid": p["cid"],
                "craft": craft["name"].strip() if craft else "未分类工艺",
                "gid": p["gid"],
                "theme": theme["name"] if theme else "未归类",
                "spec": (p["spec"] or "").strip(),
                "price": int(p["price"] or 0),
            }
        )

    image_count = sync_media(ROOT / "images", SITE / "images")
    thumb_count = sync_media(ROOT / "thumbnail", SITE / "thumb")

    payload = {
        "meta": {
            "generatedAt": datetime.now(TZ).isoformat(timespec="seconds"),
            "source": "product.db",
            "productCount": len(out_products),
            "imageCount": image_count,
            "thumbCount": thumb_count,
        },
        "styles": style_rows,
        "crafts": craft_rows,
        "themes": theme_rows,
        "products": out_products,
    }

    SITE.mkdir(parents=True, exist_ok=True)
    data_path = SITE / "data.json"
    data_path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    print(
        f"wrote {data_path.relative_to(ROOT)} "
        f"({data_path.stat().st_size / 1024:.1f} KiB): "
        f"{len(out_products)} products, {len(style_rows)} styles, "
        f"{len(craft_rows)} crafts, {len(theme_rows)} themes, "
        f"{image_count} images, {thumb_count} thumbs"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

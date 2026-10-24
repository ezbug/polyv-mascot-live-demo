#!/usr/bin/env python3
"""
投图即用：把 demo/inbox/ 里的 PNG 处理成 demo 用的 512x512 透明帧。

用法（在项目根目录或任意目录）：
    python3 tools/build-frames.py

处理：抠白底 -> 去空白 -> 统一高度 512 -> 底部对齐 512x512 画布
输出：demo/assets/full-<id>.png
清单：demo/assets/full-manifest.json（demo 启动时读取，决定哪些动作可用）
"""
import json
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

DEMO = Path(__file__).resolve().parents[1]           # demo/
INBOX = DEMO / "inbox"
MANIFEST = DEMO / "tools" / "manifest.json"
ASSETS = DEMO / "assets"
OUT_MANIFEST = ASSETS / "full-manifest.json"
CANVAS = 512

# 已有默认帧（当前 demo 自带）
DEFAULT_SLOTS = {
    "neutral": "full-neutral.png", "smile": "full-smile.png", "blink": "full-blink.png",
    "A": "full-A.png", "I": "full-I.png", "U": "full-U.png", "E": "full-E.png", "O": "full-O.png",
    "left": "full-left.png", "back": "full-back.png",
}


def cut_white(img: Image.Image) -> Image.Image:
    img = img.convert("RGBA")
    arr = list(img.getdata())
    w, h = img.size
    # 已经有透明通道就不抠
    if img.getextrema()[3][0] < 10:
        return img
    px = img.load()
    white = bytearray(w * h)
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            white[y * w + x] = 1 if (r >= 244 and g >= 244 and b >= 244) else 0

    visited = bytearray(w * h)
    q = deque()

    def seed(x, y):
        i = y * w + x
        if white[i] and not visited[i]:
            visited[i] = 1
            q.append((x, y))

    for x in range(w):
        seed(x, 0); seed(x, h - 1)
    for y in range(h):
        seed(0, y); seed(w - 1, y)

    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h:
                i = ny * w + nx
                if white[i] and not visited[i]:
                    visited[i] = 1
                    q.append((nx, ny))

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    op = out.load()
    for y in range(h):
        row = y * w
        for x in range(w):
            if not visited[row + x]:
                op[x, y] = px[x, y]
    return out


def clean_white_edge(img: Image.Image) -> Image.Image:
    """去掉白底抠图留下的白边/白晕：只处理紧贴透明区域的近白像素。"""
    arr = np.array(img.convert("RGBA")).copy()
    alpha = arr[:, :, 3]
    if (alpha > 0).sum() == 0:
        return img
    transparent = (alpha < 8).astype(np.uint8) * 255
    near = np.array(Image.fromarray(transparent).filter(ImageFilter.MaxFilter(5))) > 0
    rgb = arr[:, :, :3].astype(int)
    bright = rgb.max(axis=2)
    kill = near & (alpha > 0) & (bright >= 246)
    arr[:, :, 3][kill] = 0
    soft = near & (arr[:, :, 3] > 0) & (bright >= 236) & (bright < 246)
    arr[:, :, 3][soft] = (arr[:, :, 3][soft] * 0.35).astype(np.uint8)
    out = Image.fromarray(arr, "RGBA")
    a = out.split()[3].filter(ImageFilter.GaussianBlur(0.6))
    out.putalpha(a)
    return out


def normalize(img: Image.Image) -> Image.Image:
    """统一：内容高 512、底对齐；水平按「胯/腿所在横带的中心」对齐，避免伸手动作让身体左右跳。"""
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    scale = CANVAS / img.height
    img = img.resize((max(1, round(img.width * scale)), CANVAS), Image.LANCZOS)
    img = clean_white_edge(img)

    # 取 72%~88% 高度（裙摆/腿/鞋）这一段，用不透明像素的水平中心作为身体锚点
    arr = img.convert("RGBA")
    pixels = arr.load()
    xs = []
    for y in range(int(CANVAS * 0.72), int(CANVAS * 0.88)):
        for x in range(arr.width):
            if pixels[x, y][3] > 40:
                xs.append(x)
    center = (min(xs) + max(xs)) / 2 if xs else arr.width / 2

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    x = max(0, min(CANVAS - arr.width, round(CANVAS / 2 - center)))
    canvas.alpha_composite(arr, (x, 0))
    return canvas


def main():
    if not MANIFEST.exists():
        sys.exit(f"找不到 {MANIFEST}")
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    slots = manifest["slots"]
    by_id = {s["id"]: s for s in slots}

    # demo 现有帧先算可用
    available = {}
    for sid, fname in DEFAULT_SLOTS.items():
        if (ASSETS / fname).exists():
            available[sid] = fname

    processed, skipped = [], []
    if not INBOX.exists():
        INBOX.mkdir(parents=True, exist_ok=True)

    for path in sorted(INBOX.glob("*.png")):
        sid = path.stem
        if sid not in by_id:
            skipped.append(f"{path.name}（不在 manifest，跳过）")
            continue
        try:
            img = normalize(cut_white(Image.open(path)))
            out = ASSETS / f"full-{sid}.png"
            img.save(out)
            available[sid] = out.name
            processed.append(f"{sid} -> {out.name} ({img.size[0]}x{img.size[1]})")
        except Exception as e:  # noqa: BLE001
            skipped.append(f"{path.name}（处理失败：{e}）")

    # 更新源 manifest 状态
    for s in slots:
        s["available"] = s["id"] in available
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    # 输出 demo 用的可用帧清单
    ASSETS.mkdir(parents=True, exist_ok=True)
    OUT_MANIFEST.write_text(json.dumps({
        "version": 2,
        "canvas": CANVAS,
        "available": available,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    # 给看板用的完整槽位 + 可用状态
    (ASSETS / "slots.json").write_text(json.dumps({
        "slots": [{"id": s["id"], "label": s["label"], "group": s["group"], "desc": s.get("desc", "")} for s in slots],
        "available": available,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    missing = [s["id"] for s in slots if s["id"] not in available]
    priority = [s for s in ["point-left", "celebrate", "shrug", "raise-hand", "clap", "heart"] if s in missing]

    print("已处理：")
    for line in processed or ["(无新图片)"]:
        print("  -", line)
    if skipped:
        print("\n跳过：")
        for line in skipped:
            print("  -", line)
    print(f"\n可用帧：{len(available)}/{len(slots)}")
    print("还缺：" + ("、".join(missing) if missing else "无"))
    if priority:
        print("优先补：" + "、".join(priority))


if __name__ == "__main__":
    main()

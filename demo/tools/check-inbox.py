#!/usr/bin/env python3
"""
素材自检：投图前后快速看一致性（尺寸、透明背景、内容高度、脚底线）。

用法：
    python3 tools/check-inbox.py
基准：demo/inbox/point-left.png（可选）
"""
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
INBOX = Path(__file__).resolve().parents[1] / "inbox"
REF = ROOT / "3D制作" / "静模样片-v01" / "inputs" / "front.png"


def cut_and_bbox(path):
    im = Image.open(path).convert("RGBA")
    a = np.array(im)
    alpha = a[:, :, 3]
    rgb = a[:, :, :3].astype(int)
    if (alpha < 10).mean() > 0.2:  # 已有透明底
        mask = alpha > 10
    else:  # 白底：按"非近白"取内容
        mask = ~((rgb[:, :, 0] > 246) & (rgb[:, :, 1] > 246) & (rgb[:, :, 2] > 246))
    ys, xs = np.where(mask)
    if not len(xs):
        return None
    # 边框是否纯白（判断白底图，白底会被 build 脚本抠掉）
    border = np.concatenate([rgb[0, :], rgb[-1, :], rgb[:, 0], rgb[:, -1]])
    white_border = ((border[:, 0] >= 246) & (border[:, 1] >= 246) & (border[:, 2] >= 246)).mean()
    return im.size, (xs.min(), ys.min(), xs.max(), ys.max()), (alpha < 10).mean(), white_border


def metrics(path):
    size, bb, alpha_ratio, white_border = cut_and_bbox(path)
    w, h = size
    cw, ch = bb[2] - bb[0] + 1, bb[3] - bb[1] + 1
    return {
        "size": f"{w}x{h}",
        "alpha0": round(alpha_ratio, 2),
        "content": f"{cw}x{ch}",
        "h_ratio": ch / h,
        "bottom_margin": (h - 1 - bb[3]) / h,
        "left_margin": bb[0] / w,
        "right_margin": (w - 1 - bb[2]) / w,
        "white_border": white_border,
    }


def main():
    ref_path = INBOX / "point-left.png"
    if not ref_path.exists():
        ref_path = REF
    ref = metrics(ref_path) if ref_path.exists() else None
    print(f"基准：{ref_path.name} " + (f"h_ratio={ref['h_ratio']:.3f} bottom={ref['bottom_margin']:.3f}" if ref else "（无基准）"))
    print()

    files = sorted(INBOX.glob("*.png"))
    if not files:
        print("inbox 里还没有 png")
        return
    for p in files:
        m = metrics(p)
        flags = []
        if m["alpha0"] < 0.15 and m["white_border"] < 0.9:
            flags.append("背景可能不是透明/纯白")
        elif m["alpha0"] < 0.15:
            flags.append("白底（build 时会自动抠）")
        if ref:
            if abs(m["h_ratio"] - ref["h_ratio"]) > 0.03:
                flags.append(f"内容高度偏差 {abs(m['h_ratio']-ref['h_ratio'])*100:.1f}%")
            if abs(m["bottom_margin"] - ref["bottom_margin"]) > 0.015:
                flags.append(f"脚底线偏差 {abs(m['bottom_margin']-ref['bottom_margin'])*100:.1f}%")
        print(f"{p.name:24} {m['size']:>10}  alpha0={m['alpha0']:<4} content={m['content']:>9} "
              f"h={m['h_ratio']:.3f} bottom={m['bottom_margin']:.3f}  " + ("ℹ " + "；".join(flags) if any('白底' in f for f in flags) else ("⚠ " + "；".join(flags) if flags else "✅")))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
外后视镜镜面轮廓 STEP 提取 — 从完整校核模型
============================================
从 STEP 文件中找 SPHERICAL_SURFACE (凸球面镜, R≈1260mm),
追踪其 ADVANCED_FACE 边界, 筛选有效边 (全在球面上), 缝合为镜面帽轮廓。

背景: 供应商的完整视野校核模型包含镜面玻璃 (SPHERICAL_SURFACE),
球心与供应商数据逐毫米吻合。从 OPEN_SHELL → ADVANCED_FACE → EDGE_LOOP
提取镜面帽边界。

用法:
  python step_sphere_mirror.py <step_file> [--output dir] [--n 30]
  python step_sphere_mirror.py <step_file> --list    # 列出球面
"""
import re
import sys
import json
import math
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import step_curve_sampler as scs
import step_topology as st
import numpy as np

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def find_spheres(entities, points):
    """找到所有 SPHERICAL_SURFACE, 返回 [{id, radius, center}]"""
    spheres = []
    for eid, (t, args) in entities.items():
        if t != "SPHERICAL_SURFACE":
            continue
        toks = scs._split_top_level(args)
        if len(toks) < 3:
            continue
        radius = float(toks[-1])
        # axis2_placement_3d ref
        axis_ref = int(re.search(r'#(\d+)', toks[1]).group(1))
        _, aargs = entities[axis_ref]
        atoks = scs._split_top_level(aargs)
        loc_ref = int(re.search(r'#(\d+)', atoks[1]).group(1))
        center = points.get(loc_ref)
        if center is not None:
            spheres.append({'id': eid, 'radius': radius,
                            'center': center.tolist(),
                            'axis_ref': axis_ref})
    return spheres


def find_sphere_faces(sphere_id, entities):
    """找到引用该球面的 ADVANCED_FACE"""
    faces = []
    for eid, (t, args) in entities.items():
        if t == "ADVANCED_FACE" and f'#{sphere_id}' in args:
            faces.append(eid)
    return faces


def extract_mirror_outline(face_id, entities, points, sphere_center, radius, n=30):
    """从面提取镜面帽轮廓: 追踪边界, 筛选有效边 (全在球面上), 缝合"""
    _, fargs = entities[face_id]
    ftoks = scs._split_top_level(fargs)
    bounds = scs._parse_ref_list(ftoks[1])
    edges = st.trace_face_boundary(face_id, bounds, entities)

    valid_edges = []
    for e in edges:
        pts, length = st.sample_edge_curve(e, entities, points, n)
        if pts is None or len(pts) < 2:
            continue
        arr = np.array(pts)
        # 有效边: 所有点距球心≈R (在球面上), 且长度合理 (<500mm)
        dists = np.linalg.norm(arr - np.array(sphere_center), axis=1)
        on_sphere = np.all(np.abs(dists - radius) < 5)
        seg_lens = np.linalg.norm(np.diff(arr, axis=0), axis=1)
        real_len = seg_lens.sum() if len(seg_lens) else 0
        if on_sphere and real_len < 500 and real_len > 1:
            valid_edges.append((e, pts, real_len))
        # 记录被筛掉的边 (调试)
        else:
            print(f"  [skip] edge #{e['edge_curve']}: on_sphere={on_sphere} len={real_len:.0f}mm")

    if not valid_edges:
        return None, []

    # 链式缝合: 从第一条边开始, 每条边找下一条 (按端点到最近)
    # 先按 EDGE_LOOP 顺序尝试, 不匹配则最近邻
    pts_list = [np.array(p) for _, p, _ in valid_edges]
    lens = [l for _, _, l in valid_edges]

    # 简单缝合: 直接按原始顺序, 去重复点 (EDGE_LOOP 顺序通常正确)
    outline = []
    prev = None
    for pts in pts_list:
        pts = list(pts)
        if prev is not None:
            # 对齐方向: 首点应接近 prev 末点
            if np.linalg.norm(pts[-1] - prev) < np.linalg.norm(pts[0] - prev):
                pts = pts[::-1]
            # 去首点重复
            if np.linalg.norm(pts[0] - prev) < 2:
                pts = pts[1:]
        outline.extend([[float(p[0]), float(p[1]), float(p[2])] for p in pts])
        prev = np.array(outline[-1])

    # 闭合
    if outline and np.linalg.norm(np.array(outline[0]) - np.array(outline[-1])) > 5:
        outline.append(outline[0])

    return outline, valid_edges


def main():
    import argparse
    parser = argparse.ArgumentParser(description="外后视镜球面镜轮廓 STEP 提取")
    parser.add_argument("step_file")
    parser.add_argument("--output", "-o", help="输出目录 (默认: step 同目录)")
    parser.add_argument("--n", type=int, default=30, help="每条边采样点数")
    parser.add_argument("--list", action="store_true", help="列出球面")
    args = parser.parse_args()

    print(f"解析 STEP: {args.step_file}")
    entities, points = scs.parse_step(args.step_file)
    print(f"实体: {len(entities)}, 点: {len(points)}")

    spheres = find_spheres(entities, points)
    print(f"\n=== 球面: {len(spheres)} 个 ===")
    for s in spheres:
        faces = find_sphere_faces(s['id'], entities)
        print(f"  #{s['id']}: R={s['radius']}mm 球心[{s['center'][0]:.1f},{s['center'][1]:.1f},{s['center'][2]:.1f}] ({len(faces)} 面)")

    if args.list:
        return

    # 提取每个球面的镜面轮廓
    out_dir = Path(args.output) if args.output else Path(args.step_file).parent
    for s in spheres:
        faces = find_sphere_faces(s['id'], entities)
        # 尝试每个面, 找到能提取出有效轮廓的 (通常 OPEN_SHELL 里的面)
        best = None
        best_len = 0
        best_face = None
        for fid in faces:
            outline, vedges = extract_mirror_outline(fid, entities, points,
                                                     s['center'], s['radius'], args.n)
            if outline and len(outline) > best_len:
                best = outline
                best_len = len(outline)
                best_face = fid
        if best:
            arr = np.array(best)
            center = arr.mean(axis=0)
            # 输出 mm, 3D 整车坐标
            out = {
                "source": "step_sphere_mirror",
                "sphere_id": s['id'],
                "sphere_center_mm": [round(v, 3) for v in s['center']],
                "radius_mm": s['radius'],
                "face_id": best_face,
                "outline_mm": [[round(float(v), 3) for v in p] for p in best],
                "outline_count": len(best),
                "unit": "mm",
                "coordinate_system": "vehicle",
            }
            side = "right" if s['center'][1] > 0 else "left"
            out_path = out_dir / f"exterior-mirror-{side}-{s['id']}.json"
            with open(out_path, 'w', encoding='utf-8') as f:
                json.dump(out, f, ensure_ascii=False, indent=2)
            print(f"\n→ {side} 镜 #{s['id']}: {len(best)} 点, 保存 {out_path}")
            print(f"  范围: X[{arr[:,0].min():.1f}~{arr[:,0].max():.1f}] "
                  f"Y[{arr[:,1].min():.1f}~{arr[:,1].max():.1f}] "
                  f"Z[{arr[:,2].min():.1f}~{arr[:,2].max():.1f}]")
        else:
            print(f"\n❌ 球面 #{s['id']}: 无法提取有效轮廓")


if __name__ == "__main__":
    main()

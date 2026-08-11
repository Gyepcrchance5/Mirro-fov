#!/usr/bin/env python3
"""
后挡风玻璃轮廓 STEP 提取
========================
从 STEP 文件中自动识别后挡风面, 提取完整边界轮廓 (所有边缝合)。

与镜面提取的区别:
  - 面名匹配: 后挡风/rear window/backlight (非 镜面/lens)
  - 边界处理: 全部边按 EDGE_LOOP 顺序缝合 (非只取最长边)
  - 无镜像: 后挡风是完整面, 不需要半模对称
  - 输出: 3D 整车坐标 mm (供 vehicle JSON 的 rear_window.outline 字段)

用法:
  python step_rear_window.py <step_file> [--n N] [--output out.json]
  python step_rear_window.py <step_file> --list    # 列出所有候选面
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


# ─── 后挡风面名匹配 ───────────────────────────────────

REAR_WINDOW_KEYWORDS = [
    '后挡风', '后风挡', '后窗', '背门玻璃',
    'rear window', 'backlight', 'rear windshield', 'rear glass',
    '后挡风玻璃', '后风窗',
]


def find_rear_window_faces(entities):
    """找名字含后挡风关键词的 ADVANCED_FACE"""
    faces = []
    for eid, (etype, args) in entities.items():
        if etype != "ADVANCED_FACE":
            continue
        tokens = scs._split_top_level(args)
        if len(tokens) < 2:
            continue
        name_raw = tokens[0].strip().strip("'")
        name = st._decode_step_name(name_raw)
        name_lower = name.lower()
        kw = any(k in name_lower for k in REAR_WINDOW_KEYWORDS)
        if kw:
            bounds_ref = scs._parse_ref_list(tokens[1])
            faces.append((eid, name, bounds_ref, tokens))
    return faces


def find_all_faces(entities):
    """列出所有 ADVANCED_FACE (降级时供用户选)"""
    faces = []
    for eid, (etype, args) in entities.items():
        if etype != "ADVANCED_FACE":
            continue
        tokens = scs._split_top_level(args)
        if len(tokens) < 2:
            continue
        name_raw = tokens[0].strip().strip("'")
        name = st._decode_step_name(name_raw)
        bounds_ref = scs._parse_ref_list(tokens[1])
        faces.append((eid, name, bounds_ref))
    return faces


def sample_face_boundary_stitched(face_eid, bounds_refs, entities, points, n=20):
    """提取面的完整边界: 所有边按 LOOP 顺序采样后缝合为一个闭合轮廓"""
    edges = st.trace_face_boundary(face_eid, bounds_refs, entities)
    if not edges:
        return None, []

    all_pts = []
    edge_info = []
    for edge in edges:
        pts, length = st.sample_edge_curve(edge, entities, points, n)
        if pts is None or len(pts) < 2:
            edge_info.append({'id': edge['edge_curve'], 'type': edge['geom_type'],
                              'length': 0, 'pts': 0, 'status': 'skip'})
            continue
        # 去首点 (与上一条边尾点重合, 避免重复)
        if all_pts:
            last = np.array(all_pts[-1])
            first = np.array(pts[0])
            if np.linalg.norm(last - first) < 1.0:
                pts = pts[1:]
        all_pts.extend([[float(p[0]), float(p[1]), float(p[2])] for p in pts])
        edge_info.append({'id': edge['edge_curve'], 'type': edge['geom_type'],
                          'length': round(length or 0, 1), 'pts': len(pts), 'status': 'ok'})

    # 闭合
    if all_pts and np.linalg.norm(np.array(all_pts[0]) - np.array(all_pts[-1])) > 1.0:
        all_pts.append(all_pts[0])

    return all_pts, edge_info


def check_coordinate_system(pts):
    """校验坐标范围是否在整车坐标系合理区间"""
    arr = np.array(pts)
    x_min, x_max = float(arr[:, 0].min()), float(arr[:, 0].max())
    y_min, y_max = float(arr[:, 1].min()), float(arr[:, 1].max())
    z_min, z_max = float(arr[:, 2].min()), float(arr[:, 2].max())
    spans = {'x': x_max - x_min, 'y': y_max - y_min, 'z': z_max - z_min}

    # 整车坐标合理范围
    ok = (-500 < x_min < 8000 and -2500 < y_min < 2500 and -500 < z_min < 3500)
    # 后挡风典型尺寸: Y跨 800~1500mm, Z跨 300~800mm
    rear_window_like = spans['y'] > 500 and spans['z'] > 200

    return {
        'ranges': {'x': [round(x_min, 1), round(x_max, 1)],
                   'y': [round(y_min, 1), round(y_max, 1)],
                   'z': [round(z_min, 1), round(z_max, 1)]},
        'spans': {k: round(v, 1) for k, v in spans.items()},
        'vehicle_coord': ok,
        'rear_window_like': rear_window_like,
    }


def main():
    import argparse
    parser = argparse.ArgumentParser(description="后挡风轮廓 STEP 提取")
    parser.add_argument("step_file", help="STEP 文件路径")
    parser.add_argument("--n", type=int, default=30, help="每条边采样点数 (默认 30)")
    parser.add_argument("--output", "-o", help="输出 JSON 路径 (默认 <step>.rear-window.json)")
    parser.add_argument("--list", action="store_true", help="列出所有候选面, 不提取")
    parser.add_argument("--face-id", type=int, help="手动指定面 ID (自动识别失败时用)")
    args = parser.parse_args()

    print(f"解析 STEP: {args.step_file}")
    entities, points = scs.parse_step(args.step_file)
    print(f"实体: {len(entities)}, 点: {len(points)}")

    # ─── 1. 找后挡风面 ──────────────────────────────────
    print("\n=== 1. 找后挡风 ADVANCED_FACE ===")
    faces = find_rear_window_faces(entities)

    if args.list:
        print(f"\n--list 模式: 列出所有 ADVANCED_FACE (共 {len(find_all_faces(entities))} 个)")
        all_faces = find_all_faces(entities)
        for fid, name, bounds in all_faces:
            # 快速采样看尺寸
            edges = st.trace_face_boundary(fid, bounds, entities)
            if not edges:
                continue
            sample_pts = []
            for edge in edges[:4]:  # 只采前4条边快速看尺寸
                pts, _ = st.sample_edge_curve(edge, entities, points, 5)
                if pts is not None:
                    sample_pts.extend([[float(p[0]), float(p[1]), float(p[2])] for p in pts])
            if len(sample_pts) < 3:
                continue
            arr = np.array(sample_pts)
            spans = f"X跨{np.ptp(arr[:,0]):.0f} Y跨{np.ptp(arr[:,1]):.0f} Z跨{np.ptp(arr[:,2]):.0f}"
            print(f"  #{fid} {name!r}: {spans} ({len(edges)} 边)")
        return

    if not faces and args.face_id is None:
        print("  ❌ 未找到后挡风面 (名字不含后挡风/rear window/backlight)")
        print("  💡 用 --list 查看所有面, 再用 --face-id #ID 手动指定")
        return

    # ─── 2. 选目标面 ────────────────────────────────────
    if args.face_id:
        # 手动指定
        target = None
        for fid, name, bounds, _ in faces:
            if fid == args.face_id:
                target = (fid, name, bounds)
                break
        if target is None:
            # 在所有面里找
            all_faces = find_all_faces(entities)
            for fid, name, bounds in all_faces:
                if fid == args.face_id:
                    target = (fid, name, bounds)
                    break
        if target is None:
            print(f"  ❌ 面 #{args.face_id} 不存在")
            return
        print(f"  手动指定: #{target[0]} {target[1]!r}")
    else:
        # 自动: 找尺寸最像后挡风的面 (Y跨>500, Z跨>200)
        print(f"\n=== 2. 从 {len(faces)} 个候选面选后挡风 ===")
        best = None
        best_score = -1
        for fid, name, bounds, _ in faces:
            edges = st.trace_face_boundary(fid, bounds, entities)
            if not edges:
                continue
            sample_pts = []
            for edge in edges:
                pts, _ = st.sample_edge_curve(edge, entities, points, 5)
                if pts is not None:
                    sample_pts.extend([[float(p[0]), float(p[1]), float(p[2])] for p in pts])
            if len(sample_pts) < 3:
                continue
            arr = np.array(sample_pts)
            y_span = np.ptp(arr[:, 1])
            z_span = np.ptp(arr[:, 2])
            score = y_span * z_span  # 面积近似
            print(f"  #{fid} {name!r}: Y跨{y_span:.0f} Z跨{z_span:.0f} (score={score:.0f})")
            if y_span > 500 and z_span > 200 and score > best_score:
                best_score = score
                best = (fid, name, bounds)
        if best is None:
            print("  ❌ 没有面符合后挡风尺寸 (Y跨>500, Z跨>200)")
            print("  💡 用 --list 查看所有面, 再用 --face-id #ID 手动指定")
            return
        target = best
        print(f"\n  ✅ 选定: #{target[0]} {target[1]!r}")

    fid, name, bounds = target

    # ─── 3. 提取完整边界 ────────────────────────────────
    print(f"\n=== 3. 提取完整边界 (面 #{fid}, 每边 {args.n} 点) ===")
    outline, edge_info = sample_face_boundary_stitched(fid, bounds, entities, points, args.n)
    if not outline or len(outline) < 4:
        print("  ❌ 边界提取失败 (点太少)")
        return

    print(f"  边数: {len(edge_info)}")
    for ei in edge_info:
        print(f"    #{ei['id']} {ei['type']} len={ei['length']}mm {ei['pts']}点 {ei['status']}")
    print(f"  轮廓总点数: {len(outline)}")

    # ─── 4. 坐标系校验 ──────────────────────────────────
    print(f"\n=== 4. 坐标系校验 ===")
    coord = check_coordinate_system(outline)
    print(f"  范围: X{coord['ranges']['x']} Y{coord['ranges']['y']} Z{coord['ranges']['z']}")
    print(f"  跨度: X{coord['spans']['x']}mm Y{coord['spans']['y']}mm Z{coord['spans']['z']}mm")
    print(f"  整车坐标: {'✅' if coord['vehicle_coord'] else '⚠️ 可能不是整车坐标'}")
    print(f"  后挡风尺寸: {'✅' if coord['rear_window_like'] else '⚠️ 尺寸异常'}")

    # ─── 5. 输出 JSON ───────────────────────────────────
    out = {
        "source": "step_rear_window",
        "step_file": args.step_file,
        "face_id": fid,
        "face_name": name,
        "outline": outline,
        "outline_count": len(outline),
        "edges": edge_info,
        "coordinate_system": "vehicle" if coord['vehicle_coord'] else "unknown",
        "ranges": coord['ranges'],
        "spans": coord['spans'],
        "unit": "mm",
    }
    out_path = args.output or str(Path(args.step_file).with_suffix('.rear-window.json'))
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"\n→ 输出: {out_path}")
    print(f"  {len(outline)} 点, 可直接用于 vehicle JSON 的 rear_window.outline 字段")


if __name__ == "__main__":
    main()

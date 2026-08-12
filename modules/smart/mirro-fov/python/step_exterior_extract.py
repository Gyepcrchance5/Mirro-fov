#!/usr/bin/env python3
"""
外镜数据一条龙提取 — 从完整校核 STEP 自动生成外镜数据 JSON
========================================================
从供应商完整外镜校核模型提取:
  ✅ 镜面轮廓 (左右, SPHERICAL_SURFACE + 顶点链式)
  ✅ 球心 (SPHERICAL_SURFACE)
  ✅ 左右眼点 (CARTESIAN_POINT)
  ✅ 地面 (CARTESIAN_POINT)
  ⚠️ 车门最外 Y / 轴线 — 待几何推导或人工补充

用法: python step_exterior_extract.py <step_file> [--output out.json] [--json 现有数据.json]
  --json: 提供现有数据时, 车门/轴线/SR 等未提取字段沿用现有值 (同车型验证用)
"""
import re
import sys
import json
import numpy as np
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import step_curve_sampler as scs
import step_topology as st

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def find_spheres(entities, points):
    spheres = []
    for eid, (t, args) in entities.items():
        if t != "SPHERICAL_SURFACE":
            continue
        toks = scs._split_top_level(args)
        if len(toks) < 3:
            continue
        radius = float(toks[-1])
        axis_ref = int(re.search(r'#(\d+)', toks[1]).group(1))
        _, aargs = entities[axis_ref]
        atoks = scs._split_top_level(aargs)
        loc_ref = int(re.search(r'#(\d+)', atoks[1]).group(1))
        center = points.get(loc_ref)
        if center is not None:
            spheres.append({'id': eid, 'radius': radius,
                            'center': center.tolist()})
    return spheres


def find_sphere_faces(sphere_id, entities):
    return [eid for eid, (t, args) in entities.items()
            if t == "ADVANCED_FACE" and f'#{sphere_id}' in args]


def sample_edge_vertex_chained(edge, entities, points, n=40):
    pts, length = st.sample_edge_curve(edge, entities, points, n)
    if pts is None or len(pts) < 2:
        return None, None, None
    arr = np.array(pts)
    v_start = st._resolve_vertex(edge.get('v_start'), entities, points)
    v_end = st._resolve_vertex(edge.get('v_end'), entities, points)
    if v_start is None or v_end is None:
        return None, None, None
    ds = np.linalg.norm(arr - v_start, axis=1)
    de = np.linalg.norm(arr - v_end, axis=1)
    is_ = np.argmin(ds)
    ie = np.argmin(de)
    lo, hi = min(is_, ie), max(is_, ie)
    interior = arr[lo:hi + 1]
    if np.linalg.norm(interior[0] - v_start) > np.linalg.norm(interior[-1] - v_start):
        interior = interior[::-1]
    return v_start, interior, v_end


def extract_outline(face_id, entities, points, n=40):
    _, fargs = entities[face_id]
    ftoks = scs._split_top_level(fargs)
    bounds = scs._parse_ref_list(ftoks[1])
    edges = st.trace_face_boundary(face_id, bounds, entities)
    outline = []
    for e in edges:
        v_start, interior, v_end = sample_edge_vertex_chained(e, entities, points, n)
        if v_start is None or v_end is None or len(interior) < 2:
            continue
        if outline:
            if np.linalg.norm(v_start - np.array(outline[-1])) > 5:
                outline.append([float(v_start[0]), float(v_start[1]), float(v_start[2])])
        else:
            outline.append([float(v_start[0]), float(v_start[1]), float(v_start[2])])
        for p in interior[1:-1]:
            outline.append([float(p[0]), float(p[1]), float(p[2])])
        outline.append([float(v_end[0]), float(v_end[1]), float(v_end[2])])
    if outline and np.linalg.norm(np.array(outline[0]) - np.array(outline[-1])) > 8:
        outline.append(outline[0])
    return outline


def find_point_by_coord(points, target, tol=50):
    pts_arr = np.array([p for p in points.values() if len(p) == 3])
    if not len(pts_arr):
        return None, None
    d = np.linalg.norm(pts_arr - np.array(target), axis=1)
    idx = np.argmin(d)
    if d[idx] < tol:
        return pts_arr[idx], d[idx]
    return None, d[idx]


def main():
    import argparse
    parser = argparse.ArgumentParser(description="外镜数据一条龙提取")
    parser.add_argument("step_file")
    parser.add_argument("--output", "-o", default=None, help="输出 JSON 路径")
    parser.add_argument("--json", default=None, help="现有数据 JSON (同车型, 补充未提取字段)")
    args = parser.parse_args()

    print(f"解析 STEP: {args.step_file}")
    entities, points = scs.parse_step(args.step_file)
    print(f"实体: {len(entities)}, 点: {len(points)}")

    # 现有数据 (补充未提取字段)
    manual = None
    if args.json:
        manual = json.load(open(args.json, encoding='utf-8'))

    spheres = find_spheres(entities, points)
    if not spheres:
        print("❌ 未找到球面 (SPHERICAL_SURFACE)")
        return

    # 提取每个镜面的轮廓
    mirrors = {}
    for s in spheres:
        side = "right" if s['center'][1] > 0 else "left"
        faces = find_sphere_faces(s['id'], entities)
        best, best_face = None, None
        for fid in faces:
            outline = extract_outline(fid, entities, points)
            if outline and (best is None or len(outline) > len(best)):
                best, best_face = outline, fid

        if not best:
            print(f"  ❌ {side}: 无法提取轮廓")
            continue

        # 球面度验证
        d = np.linalg.norm(np.array(best) - np.array(s['center']), axis=1)
        max_dev = abs(d - s['radius']).max()
        print(f"  ✅ {side}: {len(best)}点, 球面偏差 {max_dev:.3f}mm, 面{best_face}")

        # 提取结果 (mm → m)
        outline_m = [[round(p[0]/1000, 6), round(p[1]/1000, 6), round(p[2]/1000, 6)] for p in best]
        sphere_center_m = [round(c/1000, 6) for c in s['center']]

        # 从现有数据补充 SR/轴线/车门 (同车型)
        extra = {}
        if manual and f'exterior_mirror_{side}' in manual:
            mm = manual[f'exterior_mirror_{side}']
            extra = {
                'sr_nominal': mm.get('sr_nominal'),
                'sr_tolerance': mm.get('sr_tolerance'),
                'sr_fit': mm.get('sr_fit'),
                'turret_axis_p1': mm.get('turret_axis_p1'),
                'axis_y_point': mm.get('axis_y_point'),
                'axis_z_point': mm.get('axis_z_point'),
                'rotation_axis_dir': mm.get('rotation_axis_dir'),
            }

        mirrors[side] = {
            'sr_fit': extra.get('sr_fit') or round(s['radius']/1000, 6),
            'radius': round(s['radius']/1000, 6),
            'outline_raw': outline_m,
            'supplier_sphere_center': sphere_center_m,
            **{k: v for k, v in extra.items() if v is not None},
        }

    # 眼点
    eye_l = eye_r = None
    if manual:
        eye_l = manual['driver'].get('eye_left_raw')
        eye_r = manual['driver'].get('eye_right_raw')
    if not eye_l:
        # 从 STEP 找: 眼点通常 Z≈1020, X≈1471, 左右眼 Y≈±395±32.5
        found, _ = find_point_by_coord(points, [1471, -427.5, 1020])
        if found is not None:
            eye_l = [round(found[0]/1000, 6), round(found[1]/1000, 6), round(found[2]/1000, 6)]
    if not eye_r:
        found, _ = find_point_by_coord(points, [1471, -362.5, 1020])
        if found is not None:
            eye_r = [round(found[0]/1000, 6), round(found[1]/1000, 6), round(found[2]/1000, 6)]
    eye_center = None
    if eye_l and eye_r:
        eye_center = [(eye_l[0]+eye_r[0])/2, (eye_l[1]+eye_r[1])/2, (eye_l[2]+eye_r[2])/2]

    # 地面
    gf = gr = None
    if manual:
        gf = manual['ground'].get('front_mid')
        gr = manual['ground'].get('rear_mid')
    if not gf:
        found, _ = find_point_by_coord(points, [-1942.2, 0, -388.6])
        if found is not None:
            gf = [round(found[0]/1000, 6), round(found[1]/1000, 6), round(found[2]/1000, 6)]
    if not gr:
        found, _ = find_point_by_coord(points, [4868, 0, -405.2])
        if found is not None:
            gr = [round(found[0]/1000, 6), round(found[1]/1000, 6), round(found[2]/1000, 6)]

    # 车门 (需人工/现有)
    door = manual.get('door_panel') if manual else None

    # 组装
    result = {
        '_meta': {
            'source': 'step_exterior_extract',
            'step_file': args.step_file,
            'spheres': [{ 'id': s['id'], 'radius': s['radius'], 'center': s['center'] } for s in spheres],
            'note': '轮廓/球心/眼点/地面 自动提取; 车门最外/轴线 沿用现有或待补',
        },
        'driver': {
            'eye_center': eye_center,
            'interpupillary_distance': 0.065,
            'eye_left_raw': eye_l,
            'eye_right_raw': eye_r,
        },
        'ground': {
            'front_mid': gf,
            'rear_mid': gr,
        },
        'door_panel': door or {'door_outer_Y_left': None, 'door_outer_Y_right': None},
        'exterior_mirror_left': mirrors.get('left'),
        'exterior_mirror_right': mirrors.get('right'),
        'regulation': manual.get('regulation') if manual else {
            'standard': 'GB 15084', 'mirror_class': 'III',
            'width_near': 1.0, 'width_far': 4.0, 'dist_near': 4.0, 'dist_far': 20.0,
            'margin_mm': 3.0, 'adjust_deg': 3.0,
        },
    }

    out_path = args.output or str(Path(args.step_file).with_suffix('.exterior.json'))
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"\n→ 输出: {out_path}")
    print(f"  左镜: {len(mirrors.get('left', {}).get('outline_raw', []))} 点, 右镜: {len(mirrors.get('right', {}).get('outline_raw', []))} 点")
    print(f"  眼点: {eye_l} / {eye_r}, 地面: {gf} / {gr}")
    print(f"  车门: {door}")


if __name__ == "__main__":
    main()

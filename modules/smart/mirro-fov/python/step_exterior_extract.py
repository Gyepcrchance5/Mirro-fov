#!/usr/bin/env python3
"""
外镜数据一条龙提取 — 从完整校核 STEP 自动生成外镜数据 JSON
========================================================
从供应商完整外镜校核模型提取:
  ✅ 镜面轮廓 (左右, SPHERICAL_SURFACE + 顶点链式)
  ✅ 球心 (SPHERICAL_SURFACE)
  ✅ 左右眼点 (CARTESIAN_POINT 眼点对几何泛化)
  ✅ 地面 (CARTESIAN_POINT 中心线最低点)
  ✅ 车门最外 Y (车身侧壁 |Y| 高百分位, 排除镜面)
  ⚠️ 轴线 — STEP 无此几何 (已证), 输出默认轴 [0,1,0] + 轮廓质心点 (阶段 3 人工补录)

用法: python step_exterior_extract.py <step_file> [--output out.json] [--json 现有数据.json]
  --json: 提供现有数据时, 车门/轴线/SR 等未提取字段沿用现有值 (同车型验证用)
"""
import re
import sys
import json
import numpy as np
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import step_curve_sampler as scs
import step_topology as st

try:
    # line_buffering: stdout 接管道时默认块缓冲, STEP_PROGRESS 进度行必须按行即时刷出
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
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


def extract_outline(face_id, entities, points, n=30):
    """从面提取镜面帽轮廓 (顶点锚定采样, 复用 step_topology 公共函数)。

    n=30 与 step_sphere_mirror 生成 draft 时的采样密度一致, 保证自动提取
    与已验证的手动 draft 几何逐点吻合 (退化 B 样条边对采样密度敏感, 见 stage0-report)。
    """
    _, fargs = entities[face_id]
    ftoks = scs._split_top_level(fargs)
    bounds = scs._parse_ref_list(ftoks[1])
    edges = st.trace_face_boundary(face_id, bounds, entities)
    outline = []
    for e in edges:
        v_start, interior, v_end = st.sample_edge_vertex_chained(e, entities, points, n)
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


def _points_array(points):
    return np.array([p for p in points.values() if len(p) == 3])


def find_door_outer_Y(points, spheres, z_band=(None, None), pct=99.5):
    """车门最外 Y (mm, 正值绝对值): 车身侧壁 |Y| 高百分位, 排除镜面。

    - 镜面 (球面玻璃 + 附近壳体) 是车身外侧的凸起, 会抬高 |Y| 百分位, 必须剔除:
      剔除到任一球心距离满足 |dist - R| < 100mm 的点。
    - 球心本身 (|Y|≈1500/1680mm) 是孤立参考点, 用 |Y|<1400mm 剔除。
    - 车门最宽处在车门中段 (Z≈360~520mm), 不限 Z 更稳; 全量 |Y| 的 99.5 百分位
      对车门皮肤 (密集簇) 稳健, 对凸起 (镜壳体/门把手, 少量点) 不敏感。
    返回 (left_mm, right_mm); 失败返回 (None, None)。
    """
    arr = _points_array(points)
    if not len(arr):
        return None, None
    mask = np.zeros(len(arr), bool)
    for s in spheres:
        d = np.linalg.norm(arr - np.array(s['center']), axis=1)
        mask |= (np.abs(d - s['radius']) < 100.0)
    body = arr[~mask]
    if z_band[0] is not None:
        body = body[(body[:, 2] >= z_band[0]) & (body[:, 2] <= z_band[1])]
    yabs = np.abs(body[:, 1])
    yabs = yabs[yabs < 1400.0]  # 剔除球心孤立参考点
    if not len(yabs):
        return None, None
    left = np.abs(body[body[:, 1] < 0][:, 1])
    right = np.abs(body[body[:, 1] > 0][:, 1])
    if not len(left) or not len(right):
        return None, None
    return float(np.percentile(left, pct)), float(np.percentile(right, pct))


def find_eyes(points):
    """眼点对几何泛化: 在驾驶员区找一对 X 同 (≤20mm)、Z 同 (≤20mm)、|ΔY|∈[55,75]mm 的点对。

    候选很多 (车身网格点), 选 X/Z 最对齐 (|ΔX|+|ΔZ| 最小) 的那对作为左右眼;
    该对即「同一高度/同一纵向位置、左右间距 55~75mm」最干净的双眼点。
    返回 (eye_l_m, eye_r_m) (整车坐标 m); 失败返回 (None, None)。
    """
    arr = _points_array(points)
    if not len(arr):
        return None, None
    # 驾驶员区: 眼高 0.8~1.3m, 前排纵向 0.5~3.0m, |Y| ≤ 1m (LHD/RHD 皆可)
    zone = arr[(arr[:, 2] >= 800) & (arr[:, 2] <= 1300)
               & (arr[:, 0] >= 500) & (arr[:, 0] <= 3000)
               & (np.abs(arr[:, 1]) <= 1000)]
    if not len(zone):
        return None, None
    groups = defaultdict(list)
    for p in zone:
        groups[(round(float(p[0]) / 20), round(float(p[2]) / 20))].append(p)
    best = None
    for pts in groups.values():
        if len(pts) < 2:
            continue
        ys = sorted(pts, key=lambda p: p[1])
        for a in range(len(ys)):
            for b in range(a + 1, len(ys)):
                dy = ys[b][1] - ys[a][1]
                if 55 <= dy <= 75:
                    score = abs(ys[a][0] - ys[b][0]) + abs(ys[a][2] - ys[b][2])
                    if best is None or score < best[0]:
                        best = (score, ys[a], ys[b])
    if best is None:
        return None, None
    _, lo, hi = best  # lo = 更负 Y (左眼), hi = 更不负 Y (右眼)
    eye_l = [round(float(lo[0]) / 1000, 6), round(float(lo[1]) / 1000, 6), round(float(lo[2]) / 1000, 6)]
    eye_r = [round(float(hi[0]) / 1000, 6), round(float(hi[1]) / 1000, 6), round(float(hi[2]) / 1000, 6)]
    return eye_l, eye_r


def find_ground(points):
    """地面两点: 中心线 (|Y|<30mm) 中 Z 最低附近的 min-X (前) / max-X (后) 点。

    返回 (front_m, rear_m) (整车坐标 m); 失败返回 (None, None)。
    """
    arr = _points_array(points)
    if not len(arr):
        return None, None
    g = arr[np.abs(arr[:, 1]) < 30]
    if not len(g):
        return None, None
    zmin = float(g[:, 2].min())
    near = g[g[:, 2] <= zmin + 30.0]  # 地面近似平面, 取最低点 ±30mm 内
    if not len(near):
        return None, None
    front = near[np.argmin(near[:, 0])]
    rear = near[np.argmax(near[:, 0])]
    front_m = [round(float(front[0]) / 1000, 6), round(float(front[1]) / 1000, 6), round(float(front[2]) / 1000, 6)]
    rear_m = [round(float(rear[0]) / 1000, 6), round(float(rear[1]) / 1000, 6), round(float(rear[2]) / 1000, 6)]
    return front_m, rear_m


def main():
    import argparse
    parser = argparse.ArgumentParser(description="外镜数据一条龙提取")
    parser.add_argument("step_file")
    parser.add_argument("--output", "-o", default=None, help="输出 JSON 路径")
    parser.add_argument("--json", default=None, help="现有数据 JSON (同车型, 补充未提取字段)")
    args = parser.parse_args()

    print(f"解析 STEP: {args.step_file}")
    print("STEP_PROGRESS|解析 STEP 文件中...")
    entities, points = scs.parse_step(args.step_file)
    print(f"实体: {len(entities)}, 点: {len(points)}")
    print(f"STEP_PROGRESS|已解析 {len(entities)} 实体, 提取镜面轮廓")

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
        # 默认轴 (STEP 无轴线几何): 旋转轴 = 整车 Y, 轴过点 = 轮廓质心 (阶段 3 人工补录)
        centroid_m = [round(float(np.mean(best, axis=0)[i])/1000, 6) for i in range(3)]

        # 从现有数据补充 SR/轴线 (同车型 --json 模式)
        sr = {'sr_nominal': 1.23, 'sr_tolerance': 0.03}
        axis = {'turret_axis_p1': centroid_m, 'rotation_axis_dir': [0.0, 1.0, 0.0],
                'axis_y_point': None, 'axis_z_point': None}
        if manual and f'exterior_mirror_{side}' in manual:
            mm = manual[f'exterior_mirror_{side}']
            sr['sr_nominal'] = mm.get('sr_nominal', sr['sr_nominal'])
            sr['sr_tolerance'] = mm.get('sr_tolerance', sr['sr_tolerance'])
            if mm.get('turret_axis_p1') is not None:
                axis['turret_axis_p1'] = mm['turret_axis_p1']
                axis['rotation_axis_dir'] = mm.get('rotation_axis_dir', axis['rotation_axis_dir'])
                axis['axis_y_point'] = mm.get('axis_y_point')
                axis['axis_z_point'] = mm.get('axis_z_point')

        mirrors[side] = {
            'sr_nominal': sr['sr_nominal'],
            'sr_tolerance': sr['sr_tolerance'],
            'sr_fit': round(s['radius']/1000, 6),
            'radius': round(s['radius']/1000, 6),
            'outline_raw': outline_m,
            'supplier_sphere_center': sphere_center_m,
            'turret_axis_p1': axis['turret_axis_p1'],
            'axis_y_point': axis['axis_y_point'],
            'axis_z_point': axis['axis_z_point'],
            'rotation_axis_dir': axis['rotation_axis_dir'],
        }

    print("STEP_PROGRESS|提取车门/眼点/地面...")
    # 车门最外 Y: --json 模式沿用现有 (m); 否则几何泛化 (mm → m, 排除镜面)
    door_left_mm, door_right_mm = find_door_outer_Y(points, spheres)
    door_left = door_right = None
    if manual and manual.get('door_panel'):
        door_left = manual['door_panel'].get('door_outer_Y_left')
        door_right = manual['door_panel'].get('door_outer_Y_right')
    if door_left is None and door_left_mm is not None:
        door_left = round(-door_left_mm / 1000, 6)
    if door_right is None and door_right_mm is not None:
        door_right = round(door_right_mm / 1000, 6)
    door = {'door_outer_Y_left': door_left, 'door_outer_Y_right': door_right}

    # 眼点 (泛化 → 硬编码回退)
    eye_l, eye_r = None, None
    if manual:
        eye_l = manual['driver'].get('eye_left_raw')
        eye_r = manual['driver'].get('eye_right_raw')
    if not eye_l or not eye_r:
        eye_l, eye_r = find_eyes(points)
    if not eye_l:
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

    # 地面 (泛化 → 硬编码回退)
    gf = gr = None
    if manual:
        gf = manual['ground'].get('front_mid')
        gr = manual['ground'].get('rear_mid')
    if not gf or not gr:
        gf, gr = find_ground(points)
    if not gf:
        found, _ = find_point_by_coord(points, [-1942.2, 0, -388.6])
        if found is not None:
            gf = [round(found[0]/1000, 6), round(found[1]/1000, 6), round(found[2]/1000, 6)]
    if not gr:
        found, _ = find_point_by_coord(points, [4868, 0, -405.2])
        if found is not None:
            gr = [round(found[0]/1000, 6), round(found[1]/1000, 6), round(found[2]/1000, 6)]

    # 组装 (顶层结构 = draft: vehicle/driver/ground/door_panel/exterior_mirror_*/regulation)
    vehicle_name = manual.get('vehicle', {}).get('name') if manual else None
    if not vehicle_name or vehicle_name.startswith('TBD'):
        vehicle_name = Path(args.step_file).stem

    result = {
        '_meta': {
            'source': 'step_exterior_extract',
            'step_file': args.step_file,
            'spheres': [{'id': s['id'], 'radius': s['radius'], 'center': s['center']} for s in spheres],
            'note': '轮廓/球心/眼点/地面/车门 自动提取; 轴线无 STEP 几何, 输出默认轴 [0,1,0]+轮廓质心, 阶段 3 人工补录',
        },
        'vehicle': {'name': vehicle_name},
        'driver': {
            'eye_center': eye_center,
            'interpupillary_distance': 0.065,
            'eye_left_raw': eye_l,
            'eye_right_raw': eye_r,
        },
        'ground': {'front_mid': gf, 'rear_mid': gr},
        'door_panel': door,
        'exterior_mirror_left': mirrors.get('left'),
        'exterior_mirror_right': mirrors.get('right'),
        'regulation': manual.get('regulation') if manual else {
            'standard': 'GB 15084', 'mirror_class': 'III',
            'width_near': 1.0, 'width_far': 4.0, 'dist_near': 4.0, 'dist_far': 20.0,
            'margin_mm': 3.0, 'adjust_deg': 3.0,
        },
    }

    out_path = args.output or str(Path(args.step_file).with_suffix('.exterior.json'))
    print("STEP_PROGRESS|写入输出文件...")
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"\n→ 输出: {out_path}")
    print(f"  左镜: {len(mirrors.get('left', {}).get('outline_raw', []))} 点, 右镜: {len(mirrors.get('right', {}).get('outline_raw', []))} 点")
    print(f"  眼点: {eye_l} / {eye_r}, 地面: {gf} / {gr}")
    print(f"  车门: {door}")


if __name__ == "__main__":
    main()

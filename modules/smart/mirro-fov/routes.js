/**
 * Express 路由 — GB 15084 内后视镜视野校核 (全功能版)
 * API: verify / auto-search / config / vehicles(list) / config?path / save / delete / catia
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const router = express.Router();

// 所有 POST 路由统一加 body parser (不全局挂载, 避免与平台 server.js 重复)
const jsonParser = express.json();

const { Mirror } = require('./engine/inner/mirror');
const { computeVirtualEye, fiveLineVerification } = require('./engine/inner/five-line');
const { searchPassingAngles, computeAngleSummary } = require('./engine/inner/auto-verify');
const { optimizePitch } = require('./engine/inner/optimizer');
const { Ground } = require('./engine/shared/plane');
const { buildRearWindow, buildProjection, rearWindowProjectionOnMirror } = require('./engine/inner/rear-window');
const { edgeDistanceTo } = require('./engine/shared/polygon');
const { vec3Sub, vec3Add, vec3Scale, vec3Dot, vec3Norm, vec3Normalize } = require('./engine/shared/geometry');
const { reflectPointAcrossPlane } = require('./engine/shared/geometry');
const { verifyExteriorBoth, loadExteriorVehicle, scanExteriorVehicles } = require('./engine/exterior/api-verify');

// ─── 车型目录 ───
const VEHICLES_DIR = path.join(__dirname, 'data', 'vehicles');
const DEFAULT_VEHICLE = path.join(VEHICLES_DIR, 'modena.json');
// Python 3DE 读取脚本根目录 (内嵌在项目内, 自包含)。
// 环境变量 MIRRO_FOV_PY_DIR 可覆盖 (指向外部 Python 项目, 如完整 Mirro-fov)。
const PY_PROJECT = process.env.MIRRO_FOV_PY_DIR
  || path.join(__dirname, 'python');

// 默认车型判定 (大小写不敏感): Windows FS 不区分大小写, 'Modena.json' 与 'modena.json' 是同一文件,
// 严格 === 比较可被大小写变体绕过 → 覆盖/删除默认车型。toLowerCase 统一后比较。
function isDefaultVehicle(p) {
  return path.resolve(String(p)).toLowerCase() === path.resolve(DEFAULT_VEHICLE).toLowerCase();
}

// 后挡风轮廓显示点数 (与 Python dashboard RW_N 对齐)
const RW_N = 7;
const RW_T_N = 4;

// ─── 配置加载 / 扫描 ───
const round3 = x => Math.round(x * 1000) / 1000;

// 错误信息友好化: 业务错误(throw new Error)保留原文; 运行时内部错误转通用提示, 防泄漏堆栈/内部字段
function friendlyError(e) {
  if (!e) return '服务器内部错误';
  const isInternal = e instanceof TypeError || e instanceof ReferenceError ||
                     e instanceof SyntaxError || e instanceof RangeError || e.code === 'ENOENT';
  if (isInternal) {
    console.error('[routes] 内部错误:', e);
    return '服务器内部错误, 请检查请求参数或车型数据文件';
  }
  console.error('[routes]', (e && e.message) || e);
  return (e && e.message) || String(e);
}

function padToN(arr, n) {
  // 等价 Python dashboard._pad_to_n: 不足则重复最后一点补到 n
  // 空数组防御: arr.length-1 = -1 → arr[-1] = undefined → [...undefined] 崩溃
  if (!Array.isArray(arr) || arr.length === 0) {
    return Array.from({ length: n }, () => [0, 0, 0]);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.min(i, arr.length - 1);
    out.push([...arr[idx]]);
  }
  return out;
}

// 加载后挡风完整轮廓 (STEP 采样, 可选)
function _loadRwOutlineFull(cfgPath, rw) {
  if (!rw.outline_path) return null;
  try {
    const rwPath = path.join(path.dirname(cfgPath), rw.outline_path);
    const rwRaw = JSON.parse(fs.readFileSync(rwPath, 'utf8'));
    if (rwRaw.outline_mm && rwRaw.outline_mm.length >= 3) {
      return rwRaw.outline_mm.map(p => p[0] == null ? [NaN, NaN, NaN] : [p[0] / 1000, p[1] / 1000, p[2] / 1000]);
    }
  } catch (e) { /* 缺失/损坏 */ }
  return null;
}

function loadVehicleJson(cfgPath) {
  // 统一标准: 与 Python 相同的字段结构 (snake_case + 米) + JSON 格式。
  // 统一标准: 与 Python 相同的字段结构 (snake_case + 米) + JSON 格式。
  // 读入后转 mm 供前端显示 (前端仍读 widthMM/pvMM 等扁平字段, 界面零改动)。
  const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const m = raw.mirror || {};
  const d = raw.driver || {};
  const g = raw.ground || {};
  const gz = (raw.visualization && raw.visualization.ground_plane_z) != null
    ? raw.visualization.ground_plane_z : (g.front_mid ? g.front_mid[2] : 0.0);
  const gf = g.front_mid || [0.5, 0.0, gz];
  const gr = g.rear_mid || [5.9, 0.0, gz];
  const rw = raw.rear_window || {};
  const outline = rw.outline || [];
  const tz = (rw.transparent_zone && rw.transparent_zone.length >= 3) ? rw.transparent_zone : outline;
  const name = (raw.vehicle && raw.vehicle.name) || path.basename(cfgPath, '.json');
  // 可选: 真实反射区轮廓 (STEP 采样, 同目录 outline_path)
  let outlineLocal = null;
  if (m.outline_path) {
    try {
      const olPath = path.join(path.dirname(cfgPath), m.outline_path);
      const olRaw = JSON.parse(fs.readFileSync(olPath, 'utf8'));
      if (olRaw.outline_local_mm && olRaw.outline_local_mm.length >= 3) {
        outlineLocal = olRaw.outline_local_mm;
      }
    } catch (e) { /* outline 缺失/损坏, 退回圆角矩形 */ }
  }
  // 可选: 后挡风完整轮廓 (STEP 采样, 同目录 rear_window.outline_path)
  let rwOutlineFull = null;
  if (rw.outline_path) {
    try {
      const rwPath = path.join(path.dirname(cfgPath), rw.outline_path);
      const rwRaw = JSON.parse(fs.readFileSync(rwPath, 'utf8'));
      if (rwRaw.outline_mm && rwRaw.outline_mm.length >= 3) {
        rwOutlineFull = rwRaw.outline_mm.map(p => [p[0] / 1000, p[1] / 1000, p[2] / 1000]); // mm→m
      }
    } catch (e) { /* 缺失/损坏, 退回 4 点简化轮廓 */ }
  }
  // 米→毫米 + round3 修约 (对齐 Python dashboard.py: round(×1000,3), 消除浮点精度尾巴)
  const x1000 = v => [round3(v[0] * 1000), round3(v[1] * 1000), round3(v[2] * 1000)];
  return {
    name, path: path.resolve(cfgPath),
    widthMM: round3(m.width * 1000), heightMM: round3(m.height * 1000),
    cornerRadiusMM: round3((m.corner_radius || 0) * 1000),
    yawDeg: m.yaw, pitchDeg: m.pitch,
    pvMM: x1000(m.pivot), czMM: x1000(m.center_zero),
    eyeMM: x1000(d.eye_center), ipdMM: round3(d.interpupillary_distance * 1000),
    gfMM: x1000(gf), grMM: x1000(gr),
    rwMM: padToN(outline, RW_N).map(x1000),   // 7 点 (显示, mm)
    rwTMM: padToN(tz, RW_T_N).map(x1000),     // 4 点 (显示, mm)
    regulation: raw.regulation || { far_distance: 60.0, required_width_at_far: 20.0 },
    groundZ: gz,
    outlineLocal,
    rwOutlineFull,
  };
}

function scanVehicles() {
  if (!fs.existsSync(VEHICLES_DIR)) return [];
  const files = fs.readdirSync(VEHICLES_DIR).filter(f => f.endsWith('.json'));
  const results = [];
  for (const f of files) {
    try {
      const cfg = loadVehicleJson(path.join(VEHICLES_DIR, f));
      results.push({ label: cfg.name, value: cfg.path, name: cfg.name });
    } catch (e) { /* skip */ }
  }
  results.sort((a, b) => a.label.localeCompare(b.label, 'zh'));
  return results;
}

// ─── 默认配置 (供引擎 auto-search 用, 返回米制) ───
function loadDefaultConfig() {
  // 统一标准: 字段结构 snake_case + 米制 (与 Python 一致)
  const raw = JSON.parse(fs.readFileSync(DEFAULT_VEHICLE, 'utf8'));
  const m = raw.mirror || {}, d = raw.driver || {}, g = raw.ground || {}, rw = raw.rear_window || {};
  const cz = m.center_zero, pv = m.pivot;
  const armOffset = cz ? [cz[0] - pv[0], cz[1] - pv[1], cz[2] - pv[2]] : (m.arm_offset || null);
  return {
    mirror: {
      width: m.width, height: m.height,
      pivot: pv, centerZero: cz, armOffset,
      yaw: m.yaw, pitch: m.pitch,
      cornerRadius: m.corner_radius || 0,
    },
    driver: { eyeCenter: d.eye_center, ipd: d.interpupillary_distance },
    ground: (g.front_mid && g.rear_mid) ? { front: g.front_mid, rear: g.rear_mid } : null,
    rearWindow: rw.outline ? { outline: rw.outline, transparentZone: (rw.transparent_zone && rw.transparent_zone.length >= 3) ? rw.transparent_zone : rw.outline } : null,
    rearWindowFull: _loadRwOutlineFull(DEFAULT_VEHICLE, rw),
    visualization: { groundZ: (raw.visualization && raw.visualization.ground_plane_z) || 0 },
    regulation: {
      farDistance: raw.regulation.far_distance,
      requiredWidth: raw.regulation.required_width_at_far,
    },
  };
}

/** 去除连续重复点 (后挡风 outline pad 产生的重复尾点), 得实际几何点 */
function dedupePoints(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 1e-9 ||
        Math.abs(last[1] - p[1]) > 1e-9 || Math.abs(last[2] - p[2]) > 1e-9) {
      out.push(p);
    }
  }
  return out;
}

/**
 * 法规地平线在镜面上的倒影曲线 (与 Python regulation_line_image_on_mirror 等价)
 */
function regulationCurve(virtualEye, mirror, farX, groundZ, halfWidth, n) {
  const ys = [];
  const step = (2 * halfWidth) / (n - 1);
  for (let i = 0; i < n; i++) ys.push(-halfWidth + i * step);

  const normal = mirror.normal;
  const pts = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    const target = [farX, ys[i], groundZ];
    const d = vec3Sub(target, virtualEye);
    const dLen = vec3Norm(d);
    if (dLen < 1e-10) continue;
    const dU = vec3Normalize(d);
    const den = vec3Dot(dU, normal);
    if (Math.abs(den) < 1e-12) continue;
    const t = vec3Dot(vec3Sub(mirror.center, virtualEye), normal) / den;
    if (t < 1e-6 || t > dLen - 1e-6) continue;
    const hit = vec3Add(virtualEye, vec3Scale(dU, t));
    const offset = vec3Sub(hit, mirror.center);
    pts[i] = {
      lx: vec3Dot(offset, mirror.rightVec) * 1000,
      ly: vec3Dot(offset, mirror.upVec) * 1000,
    };
  }
  return pts;
}

function computeArmOffset(pivot, centerZero) {
  if (centerZero) return [centerZero[0] - pivot[0], centerZero[1] - pivot[1], centerZero[2] - pivot[2]];
  return null;
}

/**
 * 完整单角度校核 (含后挡风视图数据)
 */
function fullVerify(params) {
  const {
    width = 0.224796, height = 0.050794,
    pivot = [2.88307, 0, 1.441017],
    centerZero = null, armOffset,
    eyeCenter = [3.24309, -0.385, 1.372], ipd = 0.065,
    groundZ = 0.193209, ground = null,
    farDist = 60.0, reqWidth = 20.0,
    yawDeg = -23.5, pitchDeg = 5.0, cornerRadius = 0.010,
    rearWindow = null, // { outline:[[x,y,z]...], transparentZone:[[...]...] }
    coverageYTol = 0.5, groundZTol = 1.0,
    outlineLocal = null, // 真实反射区轮廓 [[lx,ly] mm] (STEP 采样, 可选)
  } = params;

  const arm = armOffset || computeArmOffset(pivot, centerZero) || [0.026145, 0.000007, 0.000863];

  const mirrorBase = { width, height, pivot, armOffset: arm, cornerRadius, outlineLocal };
  const eyePoints = { center: eyeCenter, ipd };
  const gd = ground ? Ground.fromTwoPoints(ground.front, ground.rear) : Ground.horizontal(groundZ);

  const summary = computeAngleSummary({
    mirrorBase, eyePoints, farDist, reqWidth, ground: gd,
    rearWindow: rearWindow ? buildRearWindow(rearWindow.outline, rearWindow.transparentZone) : null,
    yawDeg, pitchDeg, coverageYTol, groundZTol,
  });
  const m = summary.mirror;
  const result = summary.five;

  const farPlaneX = summary.farPlaneX;
  const halfW = reqWidth / 2;
  const centerVirtualEye = reflectPointAcrossPlane(eyeCenter, m.center, m.normal);
  // 法规地平线 Z 必须与五线判定的 ground 一致 (两点定线时用坡度 z_at_x, 不用裸 groundZ) — 修 A4
  const regGroundZ = gd.zAtX(farPlaneX);
  const regulationImg = regulationCurve(centerVirtualEye, m, farPlaneX, regGroundZ, halfW, 80);

  // ─── 后挡风视图数据 (对齐 build_rear_window_view_fig) ───
  let rwView = null;
  let rwProjection = null;
  if (rearWindow) {
    const rw = buildRearWindow(rearWindow.outline, rearWindow.transparentZone);
    const proj = buildProjection(rw);
    const outline2D = rw.outline.map(proj.to2d);
    const tz2D = rw.tz.map(proj.to2d);
    // 中心眼 3 线 (前 3 条), 距边距离: 每条线固定连到一个边 (不随角度变)
    // BL→左边 (左半的竖向边), BR→右边 (右半的竖向边), +X→上边 (上半的横向边)
    const lineEdgeMap = { 'BL': 'left', 'BR': 'right', '+X': 'top' };
    const centerLines = result.lineDetails.slice(0, 3).map(ld => {
      const p = { label: `C→${ld.endpointLabel}`, through: ld.throughTransparent };
      if (ld.rearWindowHit) {
        const [u, v] = proj.to2d(ld.rearWindowHit);
        p.hit2D = [round1(u), round1(v)];
        const edgeSide = lineEdgeMap[ld.endpointLabel] || 'left';
        let bestDist = Infinity, bestEx = 0, bestEy = 0;
        for (let i = 0; i < outline2D.length; i++) {
          const j = (i + 1) % outline2D.length;
          const [ax, ay] = outline2D[i], [bx, by] = outline2D[j];
          const midU = (ax + bx) / 2, midV = (ay + by) / 2;
          const du = Math.abs(bx - ax), dv = Math.abs(by - ay); // 边的 u/v 方向跨度
          // BL/BR 找竖向边 (dv>du, 即 Z 方向变化大于 Y 方向)
          // +X 找横向边 (du>dv, 即 Y 方向变化大于 Z 方向)
          if (edgeSide === 'left' && (midU > 0 || du > dv)) continue;
          if (edgeSide === 'right' && (midU < 0 || du > dv)) continue;
          if (edgeSide === 'top' && (midV < 0 || dv > du)) continue;
          const d = edgeDistanceTo(u, v, ax, ay, bx, by);
          if (d.dist < bestDist) { bestDist = d.dist; bestEx = d.ex; bestEy = d.ey; }
        }
        // 退回: 对应区域没找到则搜全部
        if (bestDist === Infinity) {
          for (let i = 0; i < outline2D.length; i++) {
            const j = (i + 1) % outline2D.length;
            const d = edgeDistanceTo(u, v, outline2D[i][0], outline2D[i][1], outline2D[j][0], outline2D[j][1]);
            if (d.dist < bestDist) { bestDist = d.dist; bestEx = d.ex; bestEy = d.ey; }
          }
        }
        p.dist = round1(bestDist);
        p.near = [round1(bestEx), round1(bestEy)];
      }
      return p;
    });
    // 后挡风开口在镜面上的投影覆盖 (报告项, 不参与 PASS 判定)
    const rwProj = rearWindowProjectionOnMirror(eyeCenter, m, rw);
    rwProjection = {
      projectionPoints2D: rwProj.projectionPoints.map(p => {
        const [u, v] = proj.to2d(p); return [round1(u), round1(v)];
      }),
      coversMirror: rwProj.coversMirror,
    };
    rwView = {
      planePoint: rw.planePoint.map(round4),
      planeNormal: rw.planeNormal.map(round4),
      outline2D: outline2D.map(([u, v]) => [round1(u), round1(v)]),
      tz2D: tz2D.map(([u, v]) => [round1(u), round1(v)]),
      centerLines,
      hasTz: rw.transparentZone !== null,
      pass: result.rearWindowPass,
      projection: rwProjection,
    };
  }

  // 数值修约 (对齐 Python: lx/ly 保留 1 位=0.1mm; 坐标向量保留 4 位=0.1μm; 消除浮点尾巴)
  const r1 = round1, r3 = round3, r4 = round4;
  const r1v = v => v ? v.map(r1) : v;       // mm 坐标向量 → 0.1mm
  const r4v = v => v ? v.map(r4) : v;       // m 坐标向量 → 0.1μm

  return {
    mirrorPass: result.mirrorPass,
    nHit: result.nHit,
    nTot: result.nTot,
    lineDetails: result.lineDetails.map(ld => ({
      eyeLabel: ld.eyeLabel, endpointLabel: ld.endpointLabel,
      rayOrigin: r4v(ld.rayOrigin), rayTarget: r4v(ld.rayTarget),
      mirrorHit: r4v(ld.mirrorHit), onMirror: ld.onMirror,
      lx: r1(ld.lx), ly: r1(ld.ly),
      rearWindowHit: r4v(ld.rearWindowHit), throughTransparent: ld.throughTransparent,
    })),
    rearWindowPass: result.rearWindowPass,
    failureDetails: result.failureDetails,
    // 参考判据 (界面不展示, 供报告/调试) — roundNums 递归修约消除浮点尾巴
    binocular: roundNums(summary.binocular),
    binocularPass: summary.binocularPass,
    binocularWidth: round4(summary.binocularWidth),
    binocularYRange: summary.binocularYRange ? summary.binocularYRange.map(round4) : summary.binocularYRange,
    singleEye: roundNums(summary.singleEye),
    viaVirtual: roundNums(summary.viaVirtual),
    mirrorProjectionCorners: result.mirrorProjectionCorners ? result.mirrorProjectionCorners.map(r4v) : result.mirrorProjectionCorners,
    crossInTriangle: result.crossInTriangle,
    mirror: {
      center: r4v(m.center), normal: r4v(m.normal),
      rightVec: r4v(m.rightVec), upVec: r4v(m.upVec),
      widthMM: r3(width * 1000), heightMM: r3(height * 1000),
      cornerRadiusMM: r3(cornerRadius * 1000),
      outline: m.reflectiveOutlineMM(),  // 真实轮廓 (有 outlineLocal 用之, 否则圆角矩形)
    },
    centerVirtualEye: r4v(centerVirtualEye),
    regulationCurve: regulationImg.map(p => p ? { lx: r1(p.lx), ly: r1(p.ly) } : p),
    farPlaneX: r4(farPlaneX), groundZ: r4(groundZ), halfW: r4(halfW),
    rearWindow: rwView,
  };
}

const round1 = x => Math.round(x * 10) / 10;
const round4 = x => Math.round(x * 10000) / 10000;
// 递归修约对象内所有 number (消除浮点尾巴, 保留 4 位=0.1μm; 不动 boolean/string/null)
const roundNums = obj => {
  if (typeof obj === 'number') return round4(obj);
  if (Array.isArray(obj)) return obj.map(roundNums);
  if (obj && typeof obj === 'object') {
    const o = {};
    for (const k of Object.keys(obj)) o[k] = roundNums(obj[k]);
    return o;
  }
  return obj;
};

// ---- 车型列表 ----
router.get('/api/vehicles', (req, res) => {
  try {
    res.json({ ok: true, vehicles: scanVehicles() });
  } catch (e) {
    res.status(500).json({ ok: false, error: friendlyError(e) });
  }
});

// ---- 获取指定车型配置 (扁平, 供前端填充表单) ----
router.get('/api/config', (req, res) => {
  try {
    const p = req.query.path || DEFAULT_VEHICLE;
    // path 越界校验 (只允许读 vehicles 目录内, 防止任意文件读)
    const resolved = path.resolve(p);
    if (!resolved.startsWith(path.resolve(VEHICLES_DIR))) {
      return res.status(400).json({ ok: false, error: '路径越界, 只能读取 vehicles 目录' });
    }
    const cfg = loadVehicleJson(resolved);
    res.json({
      ok: true,
      name: cfg.name, path: cfg.path,
      widthMM: cfg.widthMM, heightMM: cfg.heightMM, cornerRadiusMM: cfg.cornerRadiusMM,
      yawDeg: cfg.yawDeg, pitchDeg: cfg.pitchDeg,
      pvMM: cfg.pvMM, czMM: cfg.czMM,
      eyeMM: cfg.eyeMM, ipdMM: cfg.ipdMM,
      gfMM: cfg.gfMM, grMM: cfg.grMM,
      rwMM: cfg.rwMM, rwTMM: cfg.rwTMM,
      groundZ: cfg.groundZ,
      outlineLocal: cfg.outlineLocal,
      rwOutlineFull: cfg.rwOutlineFull,
      farDist: cfg.regulation.far_distance, reqWidth: cfg.regulation.required_width_at_far,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: friendlyError(e) });
  }
});

// ---- 单角度校核 ----
router.post('/api/verify', jsonParser, (req, res) => {
  try {
    const body = req.body || {};
    // 输入校验: 关键角度/尺寸必须是有限数, 否则 NaN 会静默传播 → 假 FAIL
    const mustFinite = { yawDeg: body.yawDeg, pitchDeg: body.pitchDeg, width: body.width, height: body.height };
    for (const [k, v] of Object.entries(mustFinite)) {
      if (v != null && !Number.isFinite(v)) throw new Error(`参数 ${k} 不是有效数值: ${v}`);
    }
    // ground 兼容: 前端发 { front:[..], rear:[..] } 或单 groundZ
    const g = body.ground || {};
    const gz = (body.groundZ != null) ? body.groundZ
      : (g.front ? g.front[2] : 0.193209);
    const params = {
      width: body.width, height: body.height,
      pivot: body.pivot, centerZero: body.centerZero, armOffset: body.armOffset,
      eyeCenter: body.eyeCenter, ipd: body.ipd,
      groundZ: gz,
      farDist: body.farDist, reqWidth: body.reqWidth,
      yawDeg: body.yawDeg, pitchDeg: body.pitchDeg,
      cornerRadius: body.cornerRadius,
      rearWindow: body.rearWindow || null,
      outlineLocal: body.outlineLocal || null,
    };
    const result = fullVerify(params);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, error: friendlyError(e) });
  }
});

// ---- pitch 优化 (二分找最优俯仰, 辅助工具, 不参与五线判定) ----
router.post('/api/optimize', jsonParser, (req, res) => {
  try {
    const body = req.body || {};
    const pivot = body.pivot ?? [2.88307, 0.0, 1.441017];
    const cz = body.centerZero ?? [2.909215, 0.000007, 1.441880];
    const armOffset = cz ? [cz[0]-pivot[0], cz[1]-pivot[1], cz[2]-pivot[2]] : (body.armOffset ?? [0.026145, 0.000007, 0.000863]);
    const mirror = {
      width: body.width ?? 0.224796, height: body.height ?? 0.050794,
      pivot, armOffset,
      yaw: (body.yawDeg ?? -23.5) * Math.PI / 180,
    };
    const eyePoints = { center: body.eyeCenter ?? [3.24309, -0.385, 1.372], ipd: body.ipd ?? 0.065 };
    const farDistance = body.farDist ?? 60.0;
    const requiredWidth = body.reqWidth ?? 20.0;
    const g = body.ground || {};
    const ground = (g.front && g.rear)
      ? Ground.fromTwoPoints(g.front, g.rear)
      : Ground.horizontal(body.groundZ ?? 0.193209);
    const result = optimizePitch({
      mirror, eyePoints, farDistance, requiredWidth, ground,
      pitchRange: body.pitchRange ?? [-5.0, 15.0],
      zMargin: body.zMargin ?? 0.0,
      tol: body.tol ?? 0.1,
      maxIter: body.maxIter ?? 50,
    });
    res.json({
      ok: true,
      optimalPitchDeg: result.optimalPitchDeg,
      converged: result.converged,
      zMinAtFar: result.zMinAtFar,
      visibleWidth: result.visibleWidth,
      searchLog: result.searchLog,
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: friendlyError(e) });
  }
});

// ---- 自动搜角 ----
router.post('/api/auto-search', jsonParser, (req, res) => {
  try {
    const cfg = loadDefaultConfig();
    const body = req.body || {};
    const mirrorBase = {
      width: body.width ?? cfg.mirror.width,
      height: body.height ?? cfg.mirror.height,
      pivot: body.pivot ?? cfg.mirror.pivot,
      cornerRadius: body.cornerRadius ?? cfg.mirror.cornerRadius,
    };
    const pv = mirrorBase.pivot;
    const cz = body.centerZero ?? cfg.mirror.centerZero;
    mirrorBase.armOffset = (cz)
      ? [cz[0] - pv[0], cz[1] - pv[1], cz[2] - pv[2]]
      : (body.armOffset ?? cfg.mirror.armOffset);
    const eyeCenter = body.eyeCenter ?? cfg.driver.eyeCenter;
    const ipd = body.ipd ?? cfg.driver.ipd;
    const gz = body.groundZ ?? cfg.visualization.groundZ;
    const farDist = cfg.regulation.farDistance;
    const reqWidth = cfg.regulation.requiredWidth;
    const eyePoints = { center: eyeCenter, ipd };
    // ground: 前端传两点定线 > 车型配置两点定线 > 水平地面
    const gd = (body.ground || cfg.ground)
      ? Ground.fromTwoPoints((body.ground || cfg.ground).front, (body.ground || cfg.ground).rear)
      : Ground.horizontal(gz);
    // rearWindow: 前端传后挡风, 搜角也参与穿透判定 (A1)
    const rw = body.rearWindow ? buildRearWindow(body.rearWindow.outline, body.rearWindow.transparentZone) : null;
    const result = searchPassingAngles({
      mirrorBase, eyePoints, farDist, reqWidth, ground: gd, rearWindow: rw,
      yawRange: body.yawRange ?? [-45, 15], pitchRange: body.pitchRange ?? [-10, 10],
      step: body.step ?? 2, seedYaw: body.seedYaw ?? -30, seedHalf: body.seedHalf ?? 12,
      coverageYTol: body.coverageYTol ?? 0.5, groundZTol: body.groundZTol ?? 1.0,
    });
    // 简化响应: 参考判据字段不塞给前端 (界面不展示)
    const { summary, grid, gridYaws, gridPitches, ...rest } = result;
    res.json({ ok: true, ...rest, best: summary ? summary.nHit : null });
  } catch (e) {
    res.status(400).json({ ok: false, error: friendlyError(e) });
  }
});

// ---- 保存车型 (CRUD) ----
router.post('/api/vehicles/save', jsonParser, (req, res) => {
  try {
    const body = req.body || {};
    const name = (body.name || '新车型').trim();
    if (!name) return res.status(400).json({ ok: false, error: '车型名不能为空' });
    const safe = name.replace(/[\\/:*?"<>|]/g, '_');
    const cfgPath = body.path || path.join(VEHICLES_DIR, `${safe}.json`);
    // path 越界校验 (对齐 /api/vehicles/delete: 只允许写 vehicles 目录内)
    const resolved = path.resolve(cfgPath);
    if (!resolved.startsWith(path.resolve(VEHICLES_DIR))) {
      return res.status(400).json({ ok: false, error: '路径越界, 只能保存到 vehicles 目录' });
    }
    // 默认车型保护: 不允许直接覆盖 modena.json (默认车型), 需另存为新名 (大小写不敏感)
    if (isDefaultVehicle(resolved) && !body.forceOverwriteDefault) {
      return res.status(400).json({ ok: false, error: '不能直接覆盖默认车型 (Modena), 请改车型名另存为新文件' });
    }

    const cfg = {
      vehicle: { name },
      mirror: {
        width: body.widthMM / 1000, height: body.heightMM / 1000,
        pivot: body.pvMM.map(v => v / 1000), center_zero: body.czMM.map(v => v / 1000),
        yaw: body.yawDeg, pitch: body.pitchDeg,
        corner_radius: (body.cornerRadiusMM || 0) / 1000,
      },
      driver: { eye_center: body.eyeMM.map(v => v / 1000), interpupillary_distance: body.ipdMM / 1000 },
      ground: { front_mid: body.gfMM.map(v => v / 1000), rear_mid: body.grMM.map(v => v / 1000) },
      rear_window: {
        outline: dedupePoints(body.rwMM || []).map(p => p.map(v => v / 1000)),
        transparent_zone: (body.rwTMM || []).map(p => p.map(v => v / 1000)),
      },
      regulation: { standard: 'GB 15084', mirror_class: 'I', far_distance: 60.0, required_width_at_far: 20.0 },
      visualization: { ground_plane_z: body.groundZ ?? (body.gfMM ? body.gfMM[2] / 1000 : 0) },
      tolerance: { coverage_y: 0.5, ground_visible_z: 1.0, pitch_convergence: 0.1 },
    };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
    res.json({ ok: true, path: cfgPath, vehicles: scanVehicles() });
  } catch (e) {
    res.status(400).json({ ok: false, error: friendlyError(e) });
  }
});

// ---- 删除车型 (CRUD) ----
router.post('/api/vehicles/delete', jsonParser, (req, res) => {
  try {
    const p = req.body.path;
    if (!p) return res.status(400).json({ ok: false, error: '缺少 path' });
    const resolved = path.resolve(p);
    if (isDefaultVehicle(resolved)) {
      return res.status(400).json({ ok: false, error: '不能删除默认车型' });
    }
    if (!resolved.startsWith(path.resolve(VEHICLES_DIR))) {
      return res.status(400).json({ ok: false, error: '路径越界' });
    }
    fs.unlinkSync(resolved);
    res.json({ ok: true, vehicles: scanVehicles() });
  } catch (e) {
    res.status(400).json({ ok: false, error: friendlyError(e) });
  }
});

// ---- 从 3DE 读取 (Node 代理调用 Python catia_extract, 输出转 JS 车型 JSON) ----
router.post('/api/catia', jsonParser, (req, res) => {
  // catia_extract 需要交互式 stdin (input() 读手动输入) + CATIA COM 弹框选点。
  // execFile 无 stdin 会让 input() 立即抛 EOFError, 故用 spawn 并把本进程 stdio 透传:
  // 用户在运行 node 服务的终端里完成选点/输入, 3DE 弹框照常弹出。
  const body = req.body || {};
  const yamlPath = body.output || path.join(VEHICLES_DIR, 'catia_read.yaml');
  // 关键: spawn 前删除陈旧 yaml, 防止连接失败(exit 0 不生成新文件)时读到旧数据 → 假成功
  try { fs.unlinkSync(yamlPath); } catch (e) { /* 文件不存在, 忽略 */ }
  const child = spawn('python', ['-m', 'mirror_fov.catia_extract', '--output', yamlPath],
    { cwd: PY_PROJECT, stdio: 'inherit', shell: process.platform === 'win32' });
  let done = false;
  const finish = (status, payload) => { if (!done) { done = true; res.status(status).json(payload); } };
  // 超时保护: CATIA 选点交互可能慢, 但 10 分钟还没完判定为卡死 (对齐 Python dashboard timeout=600)
  const timeout = setTimeout(() => {
    try { child.kill(); } catch (e) {}
    finish(500, { ok: false, error: '3DE 读取超时 (10 分钟未完成)。请确认 CATIA 选点操作是否仍在进行。' });
  }, 600000);
  child.on('exit', (code) => {
    clearTimeout(timeout);

    if (code !== 0) {
      finish(500, { ok: false, error: `3DE 读取中断 (exit code ${code})。\n请确认 3DE 已启动并在终端完成选点。` });
      return;
    }
    // catia_extract 连接失败时 exit code 也是 0 (只打印错误), 但不会生成 yaml → 判为连接失败
    if (!fs.existsSync(yamlPath)) {
      finish(500, { ok: false, error: '3DE 读取未产生数据文件。\n请确认本机已安装并启动 3DEXPERIENCE/CATIA（当前电脑可能未安装 3DE）。\n也可在服务终端查看 catia_extract 的详细输出。' });
      return;
    }
    try {
      // catia_extract 输出 YAML (snake_case + 米制), 读入后补全为统一 json 标准 (snake_case + 米)
      const yaml = require('js-yaml');
      const pyCfg = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
      const m = pyCfg.mirror || {}, d = pyCfg.driver || {}, g = pyCfg.ground || {}, rw = pyCfg.rear_window || {};
      const name = (pyCfg.vehicle && pyCfg.vehicle.name) || '3DE读取';
      const safe = name.replace(/[\\/:*?"<>|]/g, '_');
      const jsPath = path.join(VEHICLES_DIR, `${safe}.json`);
      const jsCfg = {
        vehicle: { name },
        mirror: m,           // 已是 snake_case + 米 (catia_extract 输出)
        driver: d,
        ground: g,
        rear_window: rw,
        regulation: pyCfg.regulation || { standard: 'GB 15084', mirror_class: 'I', far_distance: 60.0, required_width_at_far: 20.0 },
        visualization: { ground_plane_z: (g.front_mid || g.front || [0, 0, 0])[2] || 0 },
        tolerance: { coverage_y: 0.5, ground_visible_z: 1.0, pitch_convergence: 0.1 },
      };
      fs.writeFileSync(jsPath, JSON.stringify(jsCfg, null, 2), 'utf8');
      finish(200, { ok: true, output: jsPath, vehicles: scanVehicles() });
    } catch (e) {
      finish(500, { ok: false, error: `3DE 读取成功但转换失败: ${friendlyError(e)}` });
    }
  });
  child.on('error', (err) => finish(500, { ok: false, error: `3DE 读取启动失败: ${friendlyError(err)}` }));
});

// ---- 静态文件 ----
router.use(express.static(path.join(__dirname, 'public')));

// ---- 外后视镜: 车型列表 (扫 data/exterior/*.json) ----
router.get('/api/exterior/vehicles', (req, res) => {
  try {
    res.json({ ok: true, vehicles: scanExteriorVehicles() });
  } catch (e) {
    res.status(500).json({ ok: false, error: friendlyError(e) });
  }
});

// ---- 外后视镜: 读取车型参数 (扁平, 供前端填表) ----
router.get('/api/exterior/config', (req, res) => {
  try {
    const p = req.query.path || '';
    const raw = loadExteriorVehicle(p || undefined);
    const sum = (m) => ({
      sr_fit: m.sr_fit, sr_nominal: m.sr_nominal, sr_tolerance: m.sr_tolerance, radius: m.radius,
      sphere_center: m.supplier_sphere_center, outline_n: m.outline_raw.length,
      turret_axis_p1: m.turret_axis_p1, rotation_axis_dir: m.rotation_axis_dir,
    });
    res.json({
      ok: true, path: p, vehicle: raw.vehicle,
      driver: raw.driver, ground: raw.ground, door_panel: raw.door_panel, regulation: raw.regulation,
      mirrors: { left: sum(raw.exterior_mirror_left), right: sum(raw.exterior_mirror_right) },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: friendlyError(e) });
  }
});

// ---- 外后视镜: 双镜合并校核 (L+R 同时, 返回结果+合并 viz) ----
router.post('/api/exterior/verify', jsonParser, (req, res) => {
  try {
    const body = req.body || {};
    const psi = Number.isFinite(body.psi) ? body.psi : 0;
    const result = verifyExteriorBoth(body.path || '', { psi });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, error: friendlyError(e) });
  }
});

// 3DE 可用性检测 (平台服务器无 Python/CATIA)
router.get('/api/catia/available', (req, res) => {
  const ok = fs.existsSync(PY_PROJECT);
  res.json({ available: ok });
});

// ---- 外后视镜: 3DE 读取 (spawn Python catia_extract --mode exterior) ----
router.post('/api/catia/exterior', jsonParser, (req, res) => {
  const body = req.body || {};
  const outPath = body.output || path.join(EXTERIOR_DIR, 'exterior-3de-read.json');
  try { fs.unlinkSync(outPath); } catch (e) { /* 不存在忽略 */ }
  const child = spawn('python', ['-m', 'mirror_fov.catia_extract', '--mode', 'exterior', '--output', outPath],
    { cwd: PY_PROJECT, stdio: 'inherit', shell: process.platform === 'win32' });
  let done = false;
  const finish = (status, payload) => { if (!done) { done = true; res.status(status).json(payload); } };
  const timeout = setTimeout(() => {
    try { child.kill(); } catch (e) {}
    finish(500, { ok: false, error: '3DE 读取超时 (10 分钟未完成)。' });
  }, 600000);
  child.on('exit', (code) => {
    clearTimeout(timeout);
    if (code !== 0) {
      finish(500, { ok: false, error: `3DE 读取中断 (exit ${code})。\n请在终端完成选点。` });
      return;
    }
    if (!fs.existsSync(outPath)) {
      finish(500, { ok: false, error: '3DE 读取未产生数据文件。\n请确认 3DE 已启动并在终端完成操作。' });
      return;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      finish(200, { ok: true, output: outPath, vehicles: scanExteriorVehicles() });
    } catch (e) {
      finish(500, { ok: false, error: `3DE 读取成功但解析失败: ${friendlyError(e)}` });
    }
  });
  child.on('error', (err) => finish(500, { ok: false, error: `3DE 启动失败: ${friendlyError(err)}` }));
});

// 静态文件 + 首页 (放最后, 平台 server.js 挂载后即生效)
router.use(express.static(path.join(__dirname, 'public')));
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = router;

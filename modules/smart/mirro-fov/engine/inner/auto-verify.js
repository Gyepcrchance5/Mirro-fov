/**
 * 自动搜角 — 等价于 Python auto_verify.py::search_passing_angles
 * 两阶段搜索: 种子区优先 → 全范围兜底; 返回完整 grid + pass_region。
 */
const { Mirror } = require('./mirror');
const { computeVirtualEye, fiveLineVerification } = require('./five-line');
const { computeFovForEye, verifyAgainstStandard, verifyBinocularUnion } = require('./ground');
const { Ground } = require('../shared/plane');
const { computeEyeVirtualImage, computeFovViaVirtualEye } = require('./virtual-image');

/**
 * 完整角度校核摘要 — 等价 Python interactive.py::compute_angle_summary
 * 五线法(主) + 反射法双眼并集(参考) + 单眼参考 + 虚像眼法(参考)
 */
function computeAngleSummary({
  mirrorBase, eyePoints, farDist, reqWidth, ground, rearWindow,
  yawDeg, pitchDeg, coverageYTol = 0.5, groundZTol = 1.0,
}) {
  const m = new Mirror({
    width: mirrorBase.width, height: mirrorBase.height,
    pivot: mirrorBase.pivot, armOffset: mirrorBase.armOffset,
    yaw: yawDeg * Math.PI / 180, pitch: pitchDeg * Math.PI / 180,
    cornerRadius: mirrorBase.cornerRadius || 0,
    outlineLocal: mirrorBase.outlineLocal || null,
  });
  if (!ground) ground = Ground.horizontal(0.0);
  const eyeCx = eyePoints.center;
  const farPlaneX = eyeCx[0] + farDist;
  const halfW = reqWidth / 2;
  const gzReg = ground.zAtX(farPlaneX);
  const regEps = [[farPlaneX, -halfW, gzReg], [farPlaneX, halfW, gzReg]];

  // 三虚像眼
  const vis = [
    computeVirtualEye([eyeCx[0], eyeCx[1] - eyePoints.ipd / 2, eyeCx[2]], m),
    computeVirtualEye([eyeCx[0], eyeCx[1] + eyePoints.ipd / 2, eyeCx[2]], m),
    computeVirtualEye(eyeCx, m),
  ];

  // 五线法 (主判据)
  const five = fiveLineVerification({ virtualEyes: vis, mirror: m, regEndpoints: regEps, rearWindow });

  // 反射法双眼并集 (参考)
  const fovL = computeFovForEye([eyeCx[0], eyeCx[1] - eyePoints.ipd / 2, eyeCx[2]], m, farPlaneX, ground);
  const fovR = computeFovForEye([eyeCx[0], eyeCx[1] + eyePoints.ipd / 2, eyeCx[2]], m, farPlaneX, ground);
  const binocular = verifyBinocularUnion(fovL, fovR, reqWidth, farPlaneX, ground, coverageYTol, groundZTol);

  // 单眼参考
  const fovC = computeFovForEye(eyeCx, m, farPlaneX, ground);
  const singleEye = {
    左眼: verifyAgainstStandard(fovL, reqWidth, farPlaneX, ground, '左眼', coverageYTol, groundZTol),
    右眼: verifyAgainstStandard(fovR, reqWidth, farPlaneX, ground, '右眼', coverageYTol, groundZTol),
    中心眼: verifyAgainstStandard(fovC, reqWidth, farPlaneX, ground, '中心眼', coverageYTol, groundZTol),
  };

  // 虚像眼法 (参考)
  const viaVirtual = computeFovViaVirtualEye(eyeCx, m, farPlaneX, '中心眼');

  const nHit = five.lineDetails.filter(l => l.onMirror).length;
  const nTot = five.lineDetails.length;

  return {
    mirror: m, five, centerVi: vis[2], binocular, farPlaneX,
    nHit, nTot, mirrorPass: five.mirrorPass,
    binocularPass: binocular.passed,
    binocularYRange: binocular.details.yRange,
    binocularWidth: binocular.visibleWidthAtFar,
    singleEye, viaVirtual,
    failureDetails: five.failureDetails,
  };
}

/**
 * 两阶段搜索 yaw-pitch 平面, 找五线法 PASS 角度
 * @returns {Object} { found, bestYaw, bestPitch, summary, passRegion, grid, gridYaws, gridPitches, elapsed }
 */
function searchPassingAngles({
  mirrorBase, eyePoints, farDist, reqWidth, ground, rearWindow,
  yawRange = [-45, 15], pitchRange = [-10, 10],
  step = 2, seedYaw = -30, seedHalf = 12,
  coverageYTol = 0.5, groundZTol = 1.0,
}) {
  const t0 = Date.now();
  const _range = (lo, hi, s) => {
    if (s <= 0) s = 1;                    // 步长非法防御
    if (hi < lo) { const t = lo; lo = hi; hi = t; }  // 倒序防御 (修 A14)
    const arr = [];
    const n = Math.round((hi - lo) / s) + 1;
    for (let i = 0; i < n; i++) arr.push(Math.round((lo + i * s) * 100) / 100);
    return arr;
  };

  // 轻量五线校验 (搜角热循环用, 只算五线法 nHit, 不算反射法/虚像等参考判据)
  const fiveHit = (yawDeg, pitchDeg) => {
    const m = new Mirror({
      width: mirrorBase.width, height: mirrorBase.height,
      pivot: mirrorBase.pivot, armOffset: mirrorBase.armOffset,
      yaw: yawDeg * Math.PI / 180, pitch: pitchDeg * Math.PI / 180,
      cornerRadius: mirrorBase.cornerRadius || 0,
    outlineLocal: mirrorBase.outlineLocal || null,
    });
    const eyeCx = eyePoints.center;
    const farPlaneX = eyeCx[0] + farDist;
    const halfW = reqWidth / 2;
    const gzReg = ground ? ground.zAtX(farPlaneX) : 0;
    const regEps = [[farPlaneX, -halfW, gzReg], [farPlaneX, halfW, gzReg]];
    const vis = [
      computeVirtualEye([eyeCx[0], eyeCx[1] - eyePoints.ipd / 2, eyeCx[2]], m),
      computeVirtualEye([eyeCx[0], eyeCx[1] + eyePoints.ipd / 2, eyeCx[2]], m),
      computeVirtualEye(eyeCx, m),
    ];
    const r = fiveLineVerification({ virtualEyes: vis, mirror: m, regEndpoints: regEps, rearWindow });
    return { nHit: r.nHit, mirrorPass: r.mirrorPass };
  };

  // 阶段1: 种子区优先
  const seedLo = Math.max(yawRange[0], seedYaw - seedHalf);
  const seedHi = Math.min(yawRange[1], seedYaw + seedHalf);
  const pitches = _range(pitchRange[0], pitchRange[1], step);
  const seedYaws = _range(seedLo, seedHi, step);

  for (const pitch of pitches) {
    for (const yaw of seedYaws) {
      const r = fiveHit(yaw, pitch);
      if (r.mirrorPass) {
        // 命中: 对 best 角度算一次完整 summary (含参考判据)
        const s = computeAngleSummary({ mirrorBase, eyePoints, farDist, reqWidth, ground, rearWindow, yawDeg: yaw, pitchDeg: pitch, coverageYTol, groundZTol });
        const gridYaws = _range(yawRange[0], yawRange[1], step);
        const gridPitches = pitches;
        const grid = gridPitches.map(() => gridYaws.map(() => -1));
        const yi = gridYaws.reduce((bi, v, i, a) => Math.abs(v - yaw) < Math.abs(a[bi] - yaw) ? i : bi, 0);
        const pi = gridPitches.reduce((bi, v, i, a) => Math.abs(v - pitch) < Math.abs(a[bi] - pitch) ? i : bi, 0);
        grid[pi][yi] = r.nHit;
        return { found: true, bestYaw: yaw, bestPitch: pitch, summary: s, passRegion: { yawMin: yaw, yawMax: yaw, pitchMin: pitch, pitchMax: pitch }, grid, gridYaws, gridPitches, elapsed: (Date.now() - t0) / 1000 };
      }
    }
  }

  // 阶段2: 全范围兜底
  const allYaws = _range(yawRange[0], yawRange[1], step);
  const seedSet = new Set(seedYaws.map(y => Math.round(y * 1e6) / 1e6));
  const grid = pitches.map(() => allYaws.map(() => -1));
  let firstPass = null;

  for (let pi = 0; pi < pitches.length; pi++) {
    for (let yi = 0; yi < allYaws.length; yi++) {
      const yaw = allYaws[yi];
      const r = fiveHit(yaw, pitches[pi]);
      grid[pi][yi] = r.nHit;
      if (!firstPass && r.mirrorPass) firstPass = { yaw, pitch: pitches[pi], nHit: r.nHit };
    }
  }

  const elapsed = (Date.now() - t0) / 1000;

  if (firstPass) {
    // 命中: 对 best 角度算一次完整 summary
    const s = computeAngleSummary({ mirrorBase, eyePoints, farDist, reqWidth, ground, rearWindow, yawDeg: firstPass.yaw, pitchDeg: firstPass.pitch, coverageYTol, groundZTol });
    firstPass.summary = s;
    const pr = passRegion(grid, allYaws, pitches);
    return { found: true, bestYaw: firstPass.yaw, bestPitch: firstPass.pitch, summary: firstPass.summary, passRegion: pr, grid, gridYaws: allYaws, gridPitches: pitches, elapsed };
  }
  return { found: false, bestYaw: null, bestPitch: null, summary: null, passRegion: { yawMin: null, yawMax: null, pitchMin: null, pitchMax: null }, grid, gridYaws: allYaws, gridPitches: pitches, elapsed };
}

/**
 * 从热图网格提取 PASS 区域 — 等价 Python _pass_region
 */
function passRegion(grid, yaws, pitches) {
  const passY = [], passP = [];
  for (let pi = 0; pi < grid.length; pi++) {
    for (let yi = 0; yi < grid[pi].length; yi++) {
      if (grid[pi][yi] === 5) { passP.push(pitches[pi]); passY.push(yaws[yi]); }
    }
  }
  if (!passY.length) return { yawMin: null, yawMax: null, pitchMin: null, pitchMax: null };
  return { yawMin: Math.min(...passY), yawMax: Math.max(...passY), pitchMin: Math.min(...passP), pitchMax: Math.max(...passP) };
}

module.exports = { searchPassingAngles, computeAngleSummary };

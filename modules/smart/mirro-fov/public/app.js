/**
 * 前端逻辑 — GB 15084 内后视镜视野校核 (全功能版)
 * 对齐 Python dashboard.py: landing/内镜页 + 车型CRUD + 后挡风视图 + 3DE代理
 */
(function () {
  'use strict';

  // ====== 调色板 (Apple 冷白: 系统蓝/绿/红) ======
  const C = {
    mirrorFace: '#0071e3',   // 系统蓝 (镜面淡填充)
    mirrorEdge: '#0071e3',   // 镜框
    hit: '#34c759',          // 系统绿 (与 PASS 徽章一致)
    miss: '#ff3b30',         // 系统红
    regulation: '#ff3b30',
    projection: '#0071e3',   // 系统蓝 (倒影曲线)
    edgeLine: '#9a9aa0',     // 弱灰 (距离线)
  };
  const SHORT_EP = { 'BL': 'BL', 'BR': 'BR', '+X': '+X' };
  const RW_LABELS = ['左上', '中上', '右上', '右中', '右下', '中下', '左下'];

  // ====== DOM refs ======
  const $ = id => document.getElementById(id);
  const elYaw = $('yaw'), elPitch = $('pitch');
  const elWidth = $('width'), elHeight = $('height'), elCornerR = $('corner-r');
  const elPvX = $('pvt-x'), elPvY = $('pvt-y'), elPvZ = $('pvt-z');
  const elCzX = $('center-zero-x'), elCzY = $('center-zero-y'), elCzZ = $('center-zero-z');
  const elEyeX = $('eye-x'), elEyeY = $('eye-y'), elEyeZ = $('eye-z');
  const elIpd = $('ipd');
  const elGfX = $('gf-x'), elGfY = $('gf-y'), elGfZ = $('gf-z');
  const elGrX = $('gr-x'), elGrY = $('gr-y'), elGrZ = $('gr-z');
  const elVerifyBtn = $('verify-btn'), elAutoBtn = $('auto-btn');
  const elLastAngles = $('last-angles'), elAutoStatus = $('auto-status');
  const elVerdictDiv = $('verdict');
  const elVerdictCount = $('verdict-count');
  const elVerdictBadge = $('verdict-badge');
  const elRwBadge = $('rw-badge');
  const elVerdictLines = $('verdict-lines');
  const elVerdictFailures = $('verdict-failures');

  const API_BASE = window.location.pathname.replace(/\/+$/, '') + '/api';
  let currentPath = null;
  let rwDirty = false; // 后挡风 CAS 卡是否被用户编辑过
  let currentOutlineLocal = null; // 真实反射区轮廓 [[lx,ly] mm] (STEP 采样, 从车型加载)
  let currentRwOutline = null;   // 后挡风完整轮廓 [[x,y,z] m] (STEP 采样, 从车型加载)

  // ====== 参数收集 ======
  const pv = (el, def) => { const v = parseFloat(el.value); return isNaN(v) ? def : v; };

  function readParams() {
    return {
      widthMM: pv(elWidth, 224.796), heightMM: pv(elHeight, 50.794),
      cornerRadiusMM: pv(elCornerR, 10.0),
      yawDeg: pv(elYaw, -23.5), pitchDeg: pv(elPitch, 5.0),
      pvMM: [pv(elPvX, 2883.07), pv(elPvY, 0), pv(elPvZ, 1441.017)],
      czMM: [pv(elCzX, 2909.215), pv(elCzY, 0.007), pv(elCzZ, 1441.88)],
      eyeMM: [pv(elEyeX, 3243.09), pv(elEyeY, -385), pv(elEyeZ, 1372)],
      ipdMM: pv(elIpd, 65),
      gfMM: [pv(elGfX, 500), pv(elGfY, 0), pv(elGfZ, 193.209)],
      grMM: [pv(elGrX, 5900), pv(elGrY, 0), pv(elGrZ, 193.209)],
      rwMM: Array.from({ length: 7 }, (_, i) => [
        pv($('rw-c' + i + '-x'), 0), pv($('rw-c' + i + '-y'), 0), pv($('rw-c' + i + '-z'), 0),
      ]),
      rwTMM: Array.from({ length: 4 }, (_, i) => [
        pv($('rw-t' + i + '-x'), 0), pv($('rw-t' + i + '-y'), 0), pv($('rw-t' + i + '-z'), 0),
      ]),
    };
  }

  // 后挡风 outline: 去连续重复 (pad 产生的重复尾点), 得实际几何点
  function dedupeOutline(pts) {
    const out = [];
    for (const p of pts) {
      const last = out[out.length - 1];
      if (!last || Math.abs(last[0] - p[0]) > 1e-9 || Math.abs(last[1] - p[1]) > 1e-9 || Math.abs(last[2] - p[2]) > 1e-9) {
        out.push(p);
      }
    }
    return out;
  }

  function toVerifyParams(p) {
    const mm = v => [v[0] / 1000, v[1] / 1000, v[2] / 1000];
    return {
      width: p.widthMM / 1000, height: p.heightMM / 1000,
      cornerRadius: p.cornerRadiusMM / 1000,
      yawDeg: p.yawDeg, pitchDeg: p.pitchDeg,
      pivot: mm(p.pvMM),
      centerZero: mm(p.czMM),
      eyeCenter: mm(p.eyeMM), ipd: p.ipdMM / 1000,
      groundZ: p.gfMM[2] / 1000,
      ground: { front: mm(p.gfMM), rear: mm(p.grMM) },
      rearWindow: {
        outline: currentRwOutline || dedupeOutline(p.rwMM).map(mm),
        transparentZone: p.rwTMM.map(mm),
      },
      outlineLocal: currentOutlineLocal,
    };
  }

  // ====== 页面路由 (landing / inner / exterior) ======
  const landingPage = $('landing-page'), innerPage = $('inner-page'), exteriorPage = $('exterior-page');
  $('enter-inner-btn').addEventListener('click', () => showPage('inner'));
  $('enter-exterior-btn').addEventListener('click', () => showPage('exterior'));
  $('back-btn').addEventListener('click', () => showPage('landing'));
  $('ext-back-btn').addEventListener('click', () => showPage('landing'));
  function showPage(name) {
    landingPage.style.display = name === 'landing' ? '' : 'none';
    innerPage.style.display = name === 'inner' ? '' : 'none';
    exteriorPage.style.display = name === 'exterior' ? '' : 'none';
    if (name === 'inner' && !innerPage.__inited) {
      innerPage.__inited = true;
      initInner();
    }
    if (name === 'exterior' && !exteriorPage.__inited) {
      exteriorPage.__inited = true;
      initExterior();
    }
  }

  // ====== 镜中倒影 (现有逻辑保留) ======
  function autoTextPos(lx, ly, allPts, hw, hh) {
    let def;
    if (lx < -hw * 0.5) def = ly > 0 ? 'top left' : 'bottom left';
    else if (lx > hw * 0.5) def = ly > 0 ? 'top right' : 'bottom right';
    else if (ly > 0) def = 'top center';
    else def = 'bottom center';
    const flip = { 'top left': 'bottom right', 'top right': 'bottom left',
                   'top center': 'bottom center', 'bottom center': 'top center',
                   'bottom left': 'top right', 'bottom right': 'top left' };
    for (const [ox, oy] of allPts) {
      if (Math.abs(ox - lx) < 25 && Math.abs(oy - ly) < 25) { def = flip[def] || def; break; }
    }
    return def;
  }

  // 尺寸标注位置: 连线中点沿垂直方向偏移, 落在远离质心(覆盖三角)一侧 — 对齐 Python _dim_label_pos
  function dimLabelPos(px, py, fx, fy, centroid, offset = 12) {
    const mx = (px + fx) / 2, my = (py + fy) / 2;
    const dx = fx - px, dy = fy - py;
    const L = Math.hypot(dx, dy);
    if (L < 1e-9) return [mx, my];
    let nx = -dy / L, ny = dx / L;                     // 垂直方向 (单位)
    const s = nx * (centroid[0] - mx) + ny * (centroid[1] - my);
    if (s > 0) { nx = -nx; ny = -ny; }                  // 质心在 +n 侧 → 放 -n 侧
    return [mx + offset * nx, my + offset * ny];
  }

  function convexHull(pts) {
    if (pts.length < 3) return pts;
    function cross(o, a, b) { return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0]); }
    pts = pts.slice().sort((a, b) => a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length-2], lo[lo.length-1], p) <= 0) lo.pop(); lo.push(p); }
    for (const p of pts.reverse()) { while (up.length >= 2 && cross(up[up.length-2], up[up.length-1], p) <= 0) up.pop(); up.push(p); }
    up.pop(); lo.pop();
    return lo.concat(up);
  }

  function renderMirrorView(data) {
    if (typeof Plotly === 'undefined') { console.warn('Plotly 未加载, 镜中倒影视图隐藏'); return; }
    const m = data.mirror;
    const hw = m.widthMM / 2, hh = m.heightMM / 2;
    const r = m.cornerRadiusMM || 0;
    const label = r > 0.01 ? `镜面 (R=${(r).toFixed(0)}mm)` : '镜面';
    const pad = Math.max(hw, hh) * 0.30;

    // 镜面轮廓: 优先用后端返回的真实轮廓 (STEP 采样), 否则前端退回圆角矩形
    let ox, oy;
    if (m.outline && m.outline.xs && m.outline.xs.length >= 3) {
      ox = m.outline.xs; oy = m.outline.ys;
    } else if (r < 0.01) {
      ox = [-hw, hw, hw, -hw, -hw]; oy = [-hh, -hh, hh, hh, -hh];
    } else {
      ox = []; oy = [];
      const arcs = [[hw-r, hh-r, 0, 90], [-hw+r, hh-r, 90, 180],
                    [-hw+r, -hh+r, 180, 270], [hw-r, -hh+r, 270, 360]];
      for (const [cx, cy, a0, a1] of arcs) {
        for (let j = 0; j <= 20; j++) {
          const a = (a0 + (a1 - a0) * j / 20) * Math.PI / 180;
          ox.push(cx + r * Math.cos(a)); oy.push(cy + r * Math.sin(a));
        }
      }
      ox.push(ox[0]); oy.push(oy[0]);
    }

    const traces = [{
      x: ox, y: oy, mode: 'lines', fill: 'toself',
      fillcolor: 'rgba(0,113,227,0.08)',
      line: { color: C.mirrorEdge, width: 2 },
      name: label, hoverinfo: 'name',
    }];

    // 法规线倒影曲线 (中心眼, 80 采样点) — 对齐 Python build_mirror_view_fig
    // 显示 20m 宽地平线在镜面上的连续倒影, 直观判断是否整个落在镜面内
    if (Array.isArray(data.regulationCurve) && data.regulationCurve.length) {
      const cv = data.regulationCurve.filter(p => p && Number.isFinite(p.lx) && Number.isFinite(p.ly));
      if (cv.length >= 2) {
        traces.push({
          x: cv.map(p => p.lx), y: cv.map(p => p.ly), mode: 'lines+markers',
          line: { color: C.projection, width: 5 },
          marker: { size: 4, color: C.projection },
          name: '法规线倒影(中心眼)',
          hovertemplate: 'lx=%{x:.1f}mm ly=%{y:.1f}mm<extra></extra>',
        });
        // BL/BR 倒影端点标记 (曲线首末点)
        const bl = cv[0], br = cv[cv.length - 1];
        traces.push({
          x: [bl.lx, br.lx], y: [bl.ly, br.ly], mode: 'markers+text',
          marker: { size: 14, color: C.projection, line: { color: 'black', width: 1 } },
          text: ['BL倒影', 'BR倒影'], textposition: 'top center',
          name: 'BL/BR倒影', showlegend: false,
          hovertemplate: 'lx=%{x:.1f} ly=%{y:.1f}<extra></extra>',
        });
      }
    }

    // 中心眼投影三角: 只连中心眼 3 点 (C→BL/BR/+X), 不含交叉线点
    // 含镜外点 (只要平面有交点 lx!=null 即收) — 对齐 Python: lr.mirror_hit is not None
    // 这样 FAIL 场景下射线打飞的方向也能看到, 便于调试
    const hullPts = [];
    if (data.lineDetails) {
      for (let i = 0; i < 3 && i < data.lineDetails.length; i++) {
        const ld0 = data.lineDetails[i];
        if (ld0.lx != null) hullPts.push([ld0.lx, ld0.ly]);
      }
    }
    if (hullPts.length >= 3) {
      const hx = hullPts.map(p => p[0]).concat(hullPts[0][0]);
      const hy = hullPts.map(p => p[1]).concat(hullPts[0][1]);
      traces.push({
        x: hx, y: hy, mode: 'lines',
        line: { color: C.projection, width: 2, dash: 'dash' },
        name: '中心眼投影三角', opacity: 0.8, hoverinfo: 'name',
      });
    }

    const shapes = [], annotations = [];
    const hitPts = [];
    // 中心眼 3 投影点质心 (距离标注垂直偏移方向参考, 避开覆盖三角) — 对齐 Python
    const triPts = [];
    if (data.lineDetails) {
      for (let i = 0; i < 3 && i < data.lineDetails.length; i++) {
        const ld0 = data.lineDetails[i];
        if (ld0.lx != null) triPts.push([ld0.lx, ld0.ly]);
      }
    }
    const triCentroid = triPts.length
      ? [triPts.reduce((s, p) => s + p[0], 0) / triPts.length, triPts.reduce((s, p) => s + p[1], 0) / triPts.length]
      : [0, 0];
    if (data.lineDetails) {
      for (let i = 0; i < data.lineDetails.length; i++) {
        const ld = data.lineDetails[i];
        if (ld.lx == null) { hitPts.push(null); continue; }
        const lx = ld.lx, ly = ld.ly;
        hitPts.push([lx, ly]);
        const color = ld.onMirror ? C.hit : C.miss;
        const short = `${ld.eyeLabel}→${SHORT_EP[ld.endpointLabel] || ld.endpointLabel}`;
        const full = `${ld.eyeLabel}→${ld.endpointLabel}`;
        const validPts = hitPts.filter(p => p !== null);
        const pos = autoTextPos(lx, ly, validPts, hw, hh);
        // 点形统一: 中心眼 3 线(最外轮廓) = 圆形; 左右眼交叉线 = 三角形
        const symbol = ld.eyeLabel === 'C' ? 'circle' : 'triangle-up';
        traces.push({
          x: [lx], y: [ly], mode: 'markers+text',
          marker: { size: 13, color, symbol, line: { color: 'black', width: 1 } },
          text: [short], textposition: pos, name: full,
          hovertemplate: `${full}<br>lx=%{x:.1f} ly=%{y:.1f}<extra></extra>`,
        });
        // 最外点(中心眼 3 线)到边框距离 — 红色密集虚线 (对齐 Python: 减法 + 避让)
        if (i < 3) {
          const ep = ld.endpointLabel;
          let edgeX, edgeY, dist;
          if (ep === 'BL') { edgeX = -hw; edgeY = ly; dist = Math.abs(lx + hw); }
          else if (ep === 'BR') { edgeX = hw; edgeY = ly; dist = Math.abs(lx - hw); }
          else { edgeX = lx; edgeY = hh; dist = Math.abs(ly - hh); }
          // 减法: 框外必标; 框内仅临界(margin<30mm)才标 — 避免数字堆叠遮挡
          if (!ld.onMirror || dist < 30) {
            shapes.push({ type: 'line', x0: lx, y0: ly, x1: edgeX, y1: edgeY,
              line: { color: '#ff3b30', width: 1.5, dash: 'dot' } });
            const [tx, ty] = dimLabelPos(lx, ly, edgeX, edgeY, triCentroid);
            annotations.push({ x: tx, y: ty, text: `${dist.toFixed(0)}mm`, showarrow: false,
              font: { size: 10, color: '#ff3b30', family: 'Arial Black' }, xanchor: 'center', yanchor: 'middle' });
          }
        }
      }
    }

    const pass = data.mirrorPass;
    const passBadge = { x: 0.99, xref: 'paper', y: 0.98, yref: 'paper',
      showarrow: false, font: { size: 20, color: 'white' },
      bgcolor: pass ? C.hit : C.miss, bordercolor: pass ? C.hit : C.miss,
      borderwidth: 2, borderpad: 6, align: 'center' };
    const layout = {
      xaxis: { title: 'lx (镜面右向, mm)', range: [-hw - pad, hw + pad],
               scaleanchor: 'y', scaleratio: 1, gridcolor: '#f0f0f2', zerolinecolor: '#e4e4e8' },
      yaxis: { title: 'ly (镜面上向, mm)', range: [-hh - pad, hh + pad],
               gridcolor: '#f0f0f2', zerolinecolor: '#e4e4e8' },
      margin: { l: 50, r: 20, t: 20, b: 40 },
      paper_bgcolor: '#fff', plot_bgcolor: '#fff',
      font: { family: '"Segoe UI", "Microsoft YaHei", sans-serif', color: '#9a9aa0', size: 11 },
      annotations: [Object.assign({ text: pass ? '<b>PASS</b>' : '<b>FAIL</b>' }, passBadge)].concat(annotations),
      shapes,
      legend: { x: 0.01, y: 0.99, bgcolor: 'rgba(255,255,255,0.85)', bordercolor: '#e4e4e8', borderwidth: 1 },
    };
    Plotly.react('mirror-view', traces, layout, { responsive: true });
  }

  // ====== 后挡风视图 (对齐 build_rear_window_view_fig) ======
  function renderRearWindowView(rw) {
    if (typeof Plotly === 'undefined') { console.warn('Plotly 未加载, 后挡风视图隐藏'); return; }
    if (!rw || !rw.outline2D || !rw.outline2D.length) { Plotly.react('rear-window-view', [], {}); return; }
    const traces = [];
    // CAS 外框
    const casClosed = rw.outline2D.concat([rw.outline2D[0]]);
    traces.push({
      x: casClosed.map(p => p[0]), y: casClosed.map(p => p[1]), mode: 'lines',
      line: { color: C.mirrorEdge, width: 3 },
      name: 'CAS外框(整体玻璃)', hoverinfo: 'name',
    });
    // 透光区
    const tzClosed = rw.tz2D.concat([rw.tz2D[0]]);
    traces.push({
      x: tzClosed.map(p => p[0]), y: tzClosed.map(p => p[1]),
      mode: 'lines', fill: 'toself',
      fillcolor: 'rgba(0,113,227,0.15)',
      line: { color: C.hit, width: 2, dash: 'dash' },
      name: '透光区', hoverinfo: 'name',
    });
    // 中心眼 3 交点 + 距边距离
    const shapes = [], annotations = [], hitPts = [];
    // 画幅范围 (以 CAS 外框为准) — 供点标签自适应定位
    const xs = rw.outline2D.map(p => p[0]), ys = rw.outline2D.map(p => p[1]);
    const rwHw = (Math.max(...xs) - Math.min(...xs)) / 2;
    const rwHh = (Math.max(...ys) - Math.min(...ys)) / 2;
    // 中心眼 3 交点质心 (标注避让参考)
    const hitVals = rw.centerLines.filter(c => c.hit2D);
    const rwCentroid = hitVals.length
      ? [hitVals.reduce((s, c) => s + c.hit2D[0], 0) / hitVals.length,
         hitVals.reduce((s, c) => s + c.hit2D[1], 0) / hitVals.length]
      : [0, 0];
    for (const cl of rw.centerLines) {
      if (!cl.hit2D) continue;
      const [lx, ly] = cl.hit2D;
      hitPts.push([lx, ly]);
      const color = cl.through ? C.hit : C.miss;
      // 点标签自适应定位 (避开其他点) — 对齐 Python _auto_text_position
      const pos = autoTextPos(lx, ly, hitPts.filter(p => p !== null), rwHw, rwHh);
      traces.push({
        x: [lx], y: [ly], mode: 'markers+text',
        marker: { size: 13, color, symbol: 'circle', line: { color: 'black', width: 1 } },
        text: [cl.label], textposition: pos,
        name: cl.label,
        hovertemplate: `${cl.label}<br>u=%{x:.1f} v=%{y:.1f}mm<extra></extra>`,
      });
      // 距边距离标注: 中点沿垂直方向偏移, 避开质心 — 对齐 Python _dim_label_pos
      if (cl.near) {
        shapes.push({ type: 'line', x0: lx, y0: ly, x1: cl.near[0], y1: cl.near[1],
          line: { color: '#ff3b30', width: 1.5, dash: 'dot' } });
        const [tx, ty] = dimLabelPos(lx, ly, cl.near[0], cl.near[1], rwCentroid);
        annotations.push({ x: tx, y: ty, text: `${cl.dist}mm`, showarrow: false,
          font: { size: 10, color: '#ff3b30', family: 'Arial Black' }, xanchor: 'center', yanchor: 'middle' });
      }
    }
    // 覆盖三角 (3点凸包)
    if (hitPts.length >= 3) {
      const hull = convexHull(hitPts);
      if (hull.length >= 3) {
        const hx = hull.map(p => p[0]).concat(hull[0][0]);
        const hy = hull.map(p => p[1]).concat(hull[0][1]);
        traces.push({ x: hx, y: hy, mode: 'lines',
          line: { color: C.projection, width: 2, dash: 'dash' }, name: '覆盖区(3点凸包)', opacity: 0.8 });
      }
    }
    // 画幅范围 (以 CAS 外框为准)
    const pad = Math.max(rwHw, rwHh) * 0.30 + 10;
    const nIn = rw.centerLines.filter(c => c.through).length;
    const tzLabel = rw.hasTz ? '透光区' : 'CAS框';
    const pass = rw.pass;
    const passBadge = { x: 0.99, xref: 'paper', y: 0.98, yref: 'paper',
      showarrow: false, font: { size: 20, color: 'white' },
      bgcolor: pass ? C.hit : C.miss, bordercolor: pass ? C.hit : C.miss,
      borderwidth: 2, borderpad: 6, align: 'center' };
    const layout = {
      xaxis: { title: 'u (玻璃宽向, mm)', range: [Math.min(...xs) - pad, Math.max(...xs) + pad],
               scaleanchor: 'y', scaleratio: 1, gridcolor: '#f0f0f2', zerolinecolor: '#e4e4e8' },
      yaxis: { title: 'v (玻璃上向, mm)', range: [Math.min(...ys) - pad, Math.max(...ys) + pad],
               gridcolor: '#f0f0f2', zerolinecolor: '#e4e4e8' },
      margin: { l: 50, r: 20, t: 20, b: 40 },
      paper_bgcolor: '#fff', plot_bgcolor: '#fff',
      font: { family: '"Segoe UI", "Microsoft YaHei", sans-serif', color: '#9a9aa0', size: 11 },
      annotations: [Object.assign({ text: pass ? '<b>PASS</b>' : '<b>FAIL</b>' }, passBadge)].concat(annotations),
      shapes,
      legend: { x: 0.01, y: 0.99, bgcolor: 'rgba(255,255,255,0.85)', bordercolor: '#e4e4e8', borderwidth: 1 },
    };
    Plotly.react('rear-window-view', traces, layout, { responsive: true });
    const rwCount = $('rw-count');
    if (rwCount) rwCount.textContent = `中心眼3线穿玻璃 ${nIn}/3 落${tzLabel}内 · ${pass ? 'PASS' : 'FAIL'}`;
  }

  // ====== 判据面板 (含 rw_pass) ======
  function renderVerdict(data) {
    const pass = data.mirrorPass;
    const alertDiv = elVerdictDiv.querySelector('.alert');
    alertDiv.className = 'alert verdict-panel py-3 px-3 mb-0 ' + (pass ? 'verdict-pass' : 'verdict-fail');
    elVerdictCount.textContent = data.nHit + '/' + data.nTot;
    elVerdictCount.className = 'mono me-1';
    elVerdictBadge.textContent = pass ? 'PASS' : 'FAIL';
    elVerdictBadge.className = 'verdict-badge ' + (pass ? 'badge-pass' : 'badge-fail');
    // rw_pass (后挡风穿透, 仅报告)
    if (data.rearWindowPass != null) {
      const rp = data.rearWindowPass;
      elRwBadge.textContent = `后挡风 ${rp ? 'PASS' : 'FAIL'}`;
      elRwBadge.className = 'rw-badge ' + (rp ? 'rw-pass' : 'rw-fail');
    }

    let lines = '';
    if (data.lineDetails) {
      for (const ld of data.lineDetails) {
        const ok = ld.onMirror;
        const lxLy = ld.lx != null ? `${ld.lx.toFixed(1)} / ${ld.ly.toFixed(1)} mm` : '—';
        lines += `<span class="verdict-line ${ok ? 'ok' : 'no'}"><i class="dot"></i>` +
                 `<b>${ld.eyeLabel}→${ld.endpointLabel}</b><s>${lxLy}</s></span>`;
      }
    }
    elVerdictLines.innerHTML = lines;
    let fail = '';
    if (data.failureDetails && data.failureDetails.length > 0) {
      fail = '<div class="verdict-fail-title">失败详情</div>';
      for (const fd of data.failureDetails) fail += `<div class="verdict-fail-item">${fd}</div>`;
    }
    elVerdictFailures.innerHTML = fail;
  }

  // ====== API 调用 ======
  async function callJson(url, body) {
    const resp = await fetch(API_BASE + url, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await resp.json().catch(() => ({ error: resp.statusText }));
    if (!resp.ok || data.ok === false) throw new Error(data.error || '请求失败');
    return data;
  }

  let verifyBusy = false; // 请求锁: 防止双击/连按 Enter 触发重复请求
  async function doVerify() {
    if (verifyBusy) return;
    verifyBusy = true;
    elVerifyBtn.disabled = true;
    elLastAngles.textContent = '正在校核...';
    try {
      const p = readParams();
      const paramsM = toVerifyParams(p);
      const data = await callJson('/verify', paramsM);
      renderVerdict(data);
      renderMirrorView(data);
      renderRearWindowView(data.rearWindow);
      elLastAngles.textContent = `已校核: yaw=${paramsM.yawDeg}° pitch=${paramsM.pitchDeg}° → 五线 ${data.nHit}/${data.nTot} ${data.mirrorPass ? 'PASS' : 'FAIL'}`;
      const panelCount = $('panel-count');
      if (panelCount) panelCount.textContent = `五线 ${data.nHit}/${data.nTot} 命中镜面 · ${data.mirrorPass ? 'PASS' : 'FAIL'}`;
    } catch (e) {
      console.error('[verify]', e);
      elLastAngles.textContent = `错误: ${e.message}`;
      elVerdictDiv.querySelector('.alert').className = 'alert verdict-panel verdict-fail py-3 px-3 mb-0';
      elVerdictCount.textContent = '-/-';
      elVerdictBadge.textContent = 'ERROR';
      elVerdictBadge.className = 'verdict-badge badge-fail';
      elVerdictLines.innerHTML = '';
      elVerdictFailures.innerHTML = `<div class="verdict-fail-item">错误: ${e.message}</div>`;
      // 清空旧图, 防止 ERROR 时残留上次结果误导
      if (typeof Plotly !== 'undefined') {
        Plotly.react('mirror-view', [], {});
        Plotly.react('rear-window-view', [], {});
      }
      const pc = $('panel-count'); if (pc) pc.textContent = '';
      const rc = $('rw-count'); if (rc) rc.textContent = '';
      const rb = $('rw-badge'); if (rb) { rb.textContent = '后挡风 --'; rb.className = 'rw-badge'; }
    } finally {
      verifyBusy = false;
      elVerifyBtn.disabled = false;
    }
  }

  async function doAutoSearch() {
    elAutoStatus.textContent = '正在搜索...';
    elAutoStatus.className = 'text-muted mt-1 searching';
    elAutoBtn.disabled = true;
    try {
      const p = readParams();
      const paramsM = toVerifyParams(p);
      const data = await callJson('/auto-search', {
        width: paramsM.width, height: paramsM.height,
        pivot: paramsM.pivot, centerZero: paramsM.centerZero,
        eyeCenter: paramsM.eyeCenter, ipd: paramsM.ipd,
        groundZ: paramsM.groundZ, cornerRadius: paramsM.cornerRadius,
        ground: paramsM.ground, rearWindow: paramsM.rearWindow,
        yawRange: [-45, 15], pitchRange: [-10, 10], step: 2, seedYaw: -30, seedHalf: 12,
      });
      if (data.found) {
        elYaw.value = data.bestYaw;
        elPitch.value = data.bestPitch;
        elAutoStatus.textContent = `找到: yaw=${data.bestYaw}° pitch=${data.bestPitch}° (${data.elapsed.toFixed(1)}s)`;
        elAutoStatus.className = 'text-muted mt-1';
        await doVerify();
      } else {
        elAutoStatus.textContent = `全范围无五线 PASS (${data.elapsed.toFixed(1)}s)`;
        elAutoStatus.className = 'text-muted mt-1';
      }
    } catch (e) {
      elAutoStatus.textContent = `错误: ${e.message}`;
      elAutoStatus.className = 'text-muted mt-1';
    } finally { elAutoBtn.disabled = false; }
  }

  // ====== 车型 CRUD ======
  async function loadVehicles() {
    const { vehicles } = await callJson('/vehicles');
    const sel = $('vehicle-select');
    sel.innerHTML = '';
    for (const v of vehicles) {
      const opt = document.createElement('option');
      opt.value = v.value; opt.textContent = v.label;
      sel.appendChild(opt);
    }
    return vehicles;
  }

  async function loadVehicleConfig(path) {
    const cfg = await callJson('/config?path=' + encodeURIComponent(path || ''));
    currentPath = cfg.path;
    // 填充全部表单
    elYaw.value = cfg.yawDeg; elPitch.value = cfg.pitchDeg;
    elWidth.value = cfg.widthMM; elHeight.value = cfg.heightMM; elCornerR.value = cfg.cornerRadiusMM;
    elPvX.value = cfg.pvMM[0]; elPvY.value = cfg.pvMM[1]; elPvZ.value = cfg.pvMM[2];
    elCzX.value = cfg.czMM[0]; elCzY.value = cfg.czMM[1]; elCzZ.value = cfg.czMM[2];
    elEyeX.value = cfg.eyeMM[0]; elEyeY.value = cfg.eyeMM[1]; elEyeZ.value = cfg.eyeMM[2];
    elIpd.value = cfg.ipdMM;
    elGfX.value = cfg.gfMM[0]; elGfY.value = cfg.gfMM[1]; elGfZ.value = cfg.gfMM[2];
    elGrX.value = cfg.grMM[0]; elGrY.value = cfg.grMM[1]; elGrZ.value = cfg.grMM[2];
    for (let i = 0; i < 7; i++) {
      $('rw-c' + i + '-x').value = cfg.rwMM[i][0];
      $('rw-c' + i + '-y').value = cfg.rwMM[i][1];
      $('rw-c' + i + '-z').value = cfg.rwMM[i][2];
    }
    for (let i = 0; i < 4; i++) {
      $('rw-t' + i + '-x').value = cfg.rwTMM[i][0];
      $('rw-t' + i + '-y').value = cfg.rwTMM[i][1];
      $('rw-t' + i + '-z').value = cfg.rwTMM[i][2];
    }
    rwDirty = false;
    currentOutlineLocal = cfg.outlineLocal || null;
    currentRwOutline = cfg.rwOutlineFull || null;
    elLastAngles.textContent = `已加载车型: ${cfg.name}`;
  }

  async function doSave() {
    try {
      const p = readParams();
      const result = await callJson('/vehicles/save', {
        path: currentPath,
        name: $('vehicle-select').selectedOptions[0]?.textContent || '新车型',
        widthMM: p.widthMM, heightMM: p.heightMM, cornerRadiusMM: p.cornerRadiusMM,
        yawDeg: p.yawDeg, pitchDeg: p.pitchDeg,
        pvMM: p.pvMM, czMM: p.czMM,
        eyeMM: p.eyeMM, ipdMM: p.ipdMM,
        gfMM: p.gfMM, grMM: p.grMM,
        rwMM: p.rwMM, rwTMM: p.rwTMM,
        groundZ: p.gfMM[2],
      });
      await loadVehicles();
      alert('已保存车型');
    } catch (e) { alert('保存失败: ' + e.message); }
  }

  async function doDelete() {
    if (!currentPath) return;
    const sel = $('vehicle-select');
    if (!confirm('确定删除该车型？此操作不可撤销。')) return;
    try {
      await callJson('/vehicles/delete', { path: currentPath });
      await loadVehicles();
      await loadVehicleConfig();
    } catch (e) { alert('删除失败: ' + e.message); }
  }

  // 另存为新车型: 不传 path → 后端用 name 生成新文件 (覆盖默认车型保护也在此生效)
  async function doSaveAs() {
    const name = (prompt('输入新车型名称:') || '').trim();
    if (!name) return;
    try {
      const p = readParams();
      const result = await callJson('/vehicles/save', {
        name, // 缺省 path → 后端 path.join(VEHICLES_DIR, `${safe}.json`)
        widthMM: p.widthMM, heightMM: p.heightMM, cornerRadiusMM: p.cornerRadiusMM,
        yawDeg: p.yawDeg, pitchDeg: p.pitchDeg,
        pvMM: p.pvMM, czMM: p.czMM,
        eyeMM: p.eyeMM, ipdMM: p.ipdMM,
        gfMM: p.gfMM, grMM: p.grMM,
        rwMM: p.rwMM, rwTMM: p.rwTMM,
        groundZ: p.gfMM[2],
      });
      await loadVehicles();
      // 切换到新车型 (按 label 匹配新 option, 兜底用后端返回路径)
      const sel = $('vehicle-select');
      let matchedPath = result.path;
      for (const opt of sel.options) {
        if (opt.textContent === name) { matchedPath = opt.value; break; }
      }
      await loadVehicleConfig(matchedPath);
      elLastAngles.textContent = `已另存为: ${name}`;
    } catch (e) { alert('另存为失败: ' + e.message); }
  }

  async function checkCatiaAvailability() {
    try {
      const r = await fetch('api/catia/available');
      const d = await r.json();
      return d.available;
    } catch (e) { return false; }
  }

  async function doCatia() {
    const btn = $('catia-btn');
    if (!confirm('将从 3DE 读取参数。\n\n请在【运行本服务的终端窗口】中完成选点与输入（CATIA 弹框选择），期间本按钮会等待。\n\n确定开始？')) return;
    btn.disabled = true;
    btn.textContent = '读取中...';
    try {
      const result = await callJson('/catia', {});
      // 后端已转成 JS 车型 JSON, 自动切到新车型 (D3)
      await loadVehicles();
      await loadVehicleConfig(result.output);
      await doVerify();
      alert('3DE 读取完成, 已切换到新车型:\n' + result.output);
    } catch (e) {
      alert('3DE 读取失败: ' + e.message + '\n\n请确认 3DE 已启动、Python/pywin32 已装、并在服务终端完成操作。');
    } finally { btn.disabled = false; btn.textContent = '从3DE读取'; }
  }

  // 外镜 3DE 读取: spawn Python catia_extract --mode exterior
  async function doExtCatia() {
    const btn = $('ext-catia-btn');
    if (!confirm('将从 3DE 读取外镜参数。\n\n流程: 眼点→地面2点→车门2点→左镜轮廓+轴线→右镜轮廓+轴线+SR手输\n请在服务终端完成选点, 期间本按钮等待。\n\n确定开始？')) return;
    btn.disabled = true; btn.textContent = '3DE读取中…'; $('ext-status').textContent = '';
    try {
      const r = await fetch('api/catia/exterior', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      alert('3DE 外镜读取完成:\n' + d.output);
      await loadExtVehicles();
      await loadExtConfig();
      await doExtVerify();
    } catch (e) {
      alert('3DE 外镜读取失败: ' + e.message + '\n\n请在服务终端查看详细输出。');
    } finally { btn.disabled = false; btn.textContent = '从3DE读取'; }
  }

  // ====== 后挡风 / 透光区参数卡动态生成 ======
  function buildRWCard(rowId, idPrefix, labelPrefix, n, labels) {
    const row = $(rowId);
    row.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const col = document.createElement('div');
      col.className = 'col';
      col.style.minWidth = '130px';
      col.innerHTML = `<div class="card shadow-sm h-100">
        <div class="card-header py-1 px-2"><div class="card-title mb-0">${labelPrefix}${i + 1}</div><small class="text-muted">${labels[i] || ''}</small></div>
        <div class="card-body py-2 px-2">
          <div class="mb-2"><label class="mb-0" style="font-size:13px">X </label><small class="unit">mm</small><input id="${idPrefix}${i}-x" type="number" step="any" class="form-control form-control-sm"></div>
          <div class="mb-2"><label class="mb-0" style="font-size:13px">Y </label><small class="unit">mm</small><input id="${idPrefix}${i}-y" type="number" step="any" class="form-control form-control-sm"></div>
          <div class="mb-2"><label class="mb-0" style="font-size:13px">Z </label><small class="unit">mm</small><input id="${idPrefix}${i}-z" type="number" step="any" class="form-control form-control-sm"></div>
        </div>
      </div>`;
      row.appendChild(col);
    }
  }

  // ====== 初始化 ======
  async function initInner() {
    buildRWCard('rw-row', 'rw-c', '后挡风 CAS 角', 7, RW_LABELS);
    buildRWCard('tz-row', 'rw-t', '后挡风 透光角', 4, ['透光角1', '透光角2', '透光角3', '透光角4']);
    // 标记后挡风卡被编辑
    for (let i = 0; i < 7; i++) {
      ['x', 'y', 'z'].forEach(ax => {
        $('rw-c' + i + '-' + ax).addEventListener('input', () => { rwDirty = true; });
      });
    }
    elVerifyBtn.addEventListener('click', doVerify);
    elAutoBtn.addEventListener('click', doAutoSearch);
    $('save-btn').addEventListener('click', doSave);
    $('save-as-btn').addEventListener('click', doSaveAs);
    $('delete-btn').addEventListener('click', doDelete);
    $('catia-btn').addEventListener('click', doCatia);
    // 3DE 可用性检测 (平台服务器无 Python/CATIA, 按钮灰掉)
    checkCatiaAvailability().then(ok => { if (!ok) { $('catia-btn').disabled = true; $('catia-btn').title = '平台环境不支持 3DE 读取, 请本地使用'; $('catia-btn').textContent = '3DE不可用'; } });
    $('vehicle-select').addEventListener('change', async (e) => {
      await loadVehicleConfig(e.target.value);
      await doVerify();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') doVerify();
    });
    await loadVehicles();
    await loadVehicleConfig();
    await doVerify();
  }

  // 支持 #inner / #landing / #exterior hash 路由
  if (window.location.hash === '#inner') showPage('inner');
  if (window.location.hash === '#exterior') showPage('exterior');
  window.addEventListener('hashchange', () => {
    const h = window.location.hash;
    showPage(h === '#inner' ? 'inner' : (h === '#exterior' ? 'exterior' : 'landing'));
  });

  // ============================================================
  // ====== 外后视镜页 (III 类, L+R 合并) ======
  // ============================================================
  let extCurrentPath = null;
  function initExterior() {
    $('ext-verify-btn').addEventListener('click', doExtVerify);
    $('ext-auto-btn').addEventListener('click', doExtAuto);
    $('ext-vehicle-select').addEventListener('change', async (e) => {
      await loadExtConfig(e.target.value);
      await doExtVerify();
    });
    // 顶栏操作 (外镜 3DE 读取)
    $('ext-catia-btn').addEventListener('click', doExtCatia);
    checkCatiaAvailability().then(ok => { if (!ok) { $('ext-catia-btn').disabled = true; $('ext-catia-btn').title = '平台环境不支持 3DE 读取, 请本地使用'; $('ext-catia-btn').textContent = '3DE不可用'; } });
    $('ext-save-btn').addEventListener('click', () => alert('外镜车型保存待实现: 外镜数据含轮廓点数组, 需完整编辑表单。'));
    $('ext-save-as-btn').addEventListener('click', () => alert('外镜另存为待实现 (同上)。'));
    $('ext-delete-btn').addEventListener('click', () => alert('外镜车型删除待实现。'));
    loadExtVehicles().then(() => loadExtConfig().then(() => doExtVerify()));
  }

  async function loadExtVehicles() {
    try {
      const r = await fetch('api/exterior/vehicles');
      const d = await r.json();
      const sel = $('ext-vehicle-select');
      sel.innerHTML = '';
      for (const v of (d.vehicles || [])) {
        const opt = document.createElement('option');
        opt.value = v.value; opt.textContent = v.label;
        sel.appendChild(opt);
      }
    } catch (e) { $('ext-status').textContent = '车型列表加载失败: ' + e.message; }
  }

  async function loadExtConfig(path) {
    try {
      const r = await fetch('api/exterior/config?path=' + encodeURIComponent(path || ''));
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      extCurrentPath = d.path;
      const set = (id, v) => { const el = $(id); if (el) el.value = v; };
      const L = d.mirrors.left, R = d.mirrors.right;
      set('ext-sr-fit', L.sr_fit); set('ext-sr-nominal', L.sr_nominal); set('ext-sr-tol', L.sr_tolerance);
      ['x', 'y', 'z'].forEach((ax, i) => {
        set('ext-c-L-' + ax, L.sphere_center[i]); set('ext-c-R-' + ax, R.sphere_center[i]);
        set('ext-p1-L-' + ax, L.turret_axis_p1[i]); set('ext-p1-R-' + ax, R.turret_axis_p1[i]);
      });
      $('ext-dir-L').textContent = '左轴: [' + L.rotation_axis_dir.map(v => v.toFixed(4)).join(', ') + ']';
      $('ext-dir-R').textContent = '右轴: [' + R.rotation_axis_dir.map(v => v.toFixed(4)).join(', ') + ']';
      ['x', 'y', 'z'].forEach((ax, i) => {
        set('ext-eye-L-' + ax, d.driver.eye_left_raw[i]);
        set('ext-eye-R-' + ax, d.driver.eye_right_raw[i]);
      });
      set('ext-ipd', d.driver.interpupillary_distance);
      set('ext-door-L', d.door_panel.door_outer_Y_left); set('ext-door-R', d.door_panel.door_outer_Y_right);
      set('ext-gf', d.ground.front_mid.map(v => v.toFixed(4)).join(', '));
      set('ext-gr', d.ground.rear_mid.map(v => v.toFixed(4)).join(', '));
      set('ext-w-near', d.regulation.width_near); set('ext-d-near', d.regulation.dist_near);
      set('ext-w-far', d.regulation.width_far); set('ext-d-far', d.regulation.dist_far);
      $('ext-badge-left').textContent = '左 --'; $('ext-badge-left').className = 'verdict-badge';
      $('ext-badge-right').textContent = '右 --'; $('ext-badge-right').className = 'verdict-badge';
      $('ext-verdict-detail').textContent = '点击校核';
      $('ext-verdict-edges').innerHTML = ''; $('ext-verdict-fit').textContent = ''; $('ext-auto-status').textContent = '';
      $('ext-status').textContent = '';
    } catch (e) { $('ext-status').textContent = '加载失败: ' + e.message; }
  }

  async function doExtVerify() {
    const btn = $('ext-verify-btn');
    btn.disabled = true; btn.textContent = '校核中…'; $('ext-status').textContent = '';
    const scale = parseFloat($('ext-scale').value);
    try {
      const r = await fetch('api/exterior/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: extCurrentPath || '', psi: 0, scale }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      renderExtVerdict(d);
      renderExtPlot(d.viz);
    } catch (e) { $('ext-status').textContent = '校核失败: ' + e.message; }
    finally { btn.disabled = false; btn.textContent = '校核'; }
  }

  // 自动搜角: 找一个 ψ 使两镜都过, 应用并重新渲染
  async function doExtAuto() {
    const btn = $('ext-auto-btn');
    btn.disabled = true; btn.textContent = '搜索中…'; $('ext-auto-status').textContent = '正在搜索…';
    const scale = parseFloat($('ext-scale').value);
    try {
      const r0 = await fetch('api/exterior/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: extCurrentPath || '', psi: 0, scale }),
      });
      const d0 = await r0.json();
      if (!d0.ok) throw new Error(d0.error);
      const cs = d0.commonSearch;
      if (!cs.found) {
        renderExtVerdict(d0); renderExtPlot(d0.viz);
        $('ext-auto-status').textContent = '±3° 内无两镜都过的角度';
        return;
      }
      // 应用最佳 ψ, 重新校核渲染
      const r1 = await fetch('api/exterior/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: extCurrentPath || '', psi: cs.bestPsi, scale }),
      });
      const d1 = await r1.json();
      if (!d1.ok) throw new Error(d1.error);
      renderExtVerdict(d1); renderExtPlot(d1.viz);
      $('ext-auto-status').textContent = `已应用 ψ=${cs.bestPsi}° (窗口 [${cs.window.join(', ')}]°)`;
    } catch (e) { $('ext-auto-status').textContent = '搜索失败: ' + e.message; }
    finally { btn.disabled = false; btn.textContent = '自动搜角'; }
  }

  function renderExtVerdict(d) {
    const mk = (ok) => `<span style="color:${ok ? '#34c759' : '#ff3b30'}">${ok ? '✓' : '✗'}</span>`;
    const side = (s, r) => {
      const b = $('ext-badge-' + s);
      b.textContent = (s === 'left' ? '左 ' : '右 ') + (r.mirrorPass ? '✅ PASS' : '❌ FAIL');
      b.className = 'verdict-badge ' + (r.mirrorPass ? 'badge-pass' : 'badge-fail');
    };
    side('left', d.left); side('right', d.right);
    // 缩放信息
    if (d.scale && Math.abs(d.scale - 1) > 0.001) {
      $('ext-verdict-detail').textContent = `×${d.scale.toFixed(2)} 缩放 · ` + (d.right.mirrorPass ? '右镜 PASS' : '右镜仍 FAIL');
    }
    const allPass = d.left.mirrorPass && d.right.mirrorPass;
    $('ext-verdict-detail').textContent = allPass ? '两镜均通过' : (d.left.search.found || d.right.search.found ? '±3° 内有解' : '±3° 内无解');
    const e = (edges) => edges.map(x => `${x.name}:${mk(x.pass)}(${x.visible})`).join(' ');
    const edgeLine = (label, r) => `<div class="mono" style="font-size:12px;line-height:1.7"><b>${label}</b> 近[${e(r.nearEdges)}] · 远[${e(r.farEdges)}] · ±3°${mk(r.search.found)}${r.search.found ? '(' + r.search.bestPsi + '°)' : ''}</div>`;
    $('ext-verdict-edges').innerHTML = edgeLine('左', d.left) + edgeLine('右', d.right);
    const fitLine = (label, r) => `<div class="mono" style="font-size:12px;color:#6e6e73;line-height:1.7"><b>${label}</b>: ${r.fit.method} 球心[${r.fit.center.map(x => x.toFixed(3)).join(',')}] 残差${r.fit.residualMm.toExponential(0)}mm 闸门${mk(r.fit.gate.ok)} 交叉${mk(r.fit.crossCheck.ok)}(${r.fit.crossCheck.devMm}mm)</div>`;
    $('ext-verdict-fit').innerHTML = fitLine('左', d.left) + fitLine('右', d.right);
  }

  // ── 2D 反射面投影 (同内镜 mirror-view 风格: u-v mm, 轮廓 + 4 投影点) ──
  function renderExtMirrorView(divId, M, pass) {
    if (typeof Plotly === 'undefined') { console.warn('Plotly 未加载'); return; }
    const traces = [];
    // 镜面轮廓 (填充, 同内镜)
    const ol = M.outlineUV.concat([M.outlineUV[0]]);
    traces.push({
      x: ol.map(p => p[0]), y: ol.map(p => p[1]), mode: 'lines', fill: 'toself',
      fillcolor: 'rgba(0,113,227,0.08)', line: { color: C.mirrorEdge, width: 2 },
      name: '反射面', hoverinfo: 'name',
    });
    // 4 投影 (2眼×2三角形) — 纯线 (投影三角形轮廓), 左眼蓝/右眼橙, 近实远虚
    // 失败看线伸出镜面轮廓外 (同内镜法规线倒影风格)
    const eyeColor = { left: C.projection, right: '#ff9500' };
    for (const proj of M.projections) {
      traces.push({
        x: proj.points.map(p => p.u), y: proj.points.map(p => p.v), mode: 'lines',
        line: { color: eyeColor[proj.eye], width: 3, dash: proj.tri === 'far' ? 'dash' : 'solid' },
        name: `${proj.eye === 'left' ? '左' : '右'}眼·${proj.tri === 'near' ? '近' : '远'}`,
        hovertemplate: 'u=%{x:.1f} v=%{y:.1f}mm<extra></extra>',
        connectgaps: false,
      });
    }
    const us = M.outlineUV.map(p => p[0]), vs = M.outlineUV.map(p => p[1]);
    const pad = Math.max(Math.max(...us) - Math.min(...us), Math.max(...vs) - Math.min(...vs)) * 0.25;
    const badge = { x: 0.99, xref: 'paper', y: 0.98, yref: 'paper', showarrow: false, font: { size: 20, color: 'white' },
      bgcolor: pass ? C.hit : C.miss, bordercolor: pass ? C.hit : C.miss, borderwidth: 2, borderpad: 6, align: 'center' };
    const layout = {
      xaxis: { title: 'u (镜面右向, mm)', range: [Math.min(...us) - pad, Math.max(...us) + pad], scaleanchor: 'y', scaleratio: 1, gridcolor: '#f0f0f2', zerolinecolor: '#e4e4e8' },
      yaxis: { title: 'v (镜面上向, mm)', range: [Math.min(...vs) - pad, Math.max(...vs) + pad], gridcolor: '#f0f0f2', zerolinecolor: '#e4e4e8' },
      margin: { l: 50, r: 20, t: 20, b: 40 }, paper_bgcolor: '#fff', plot_bgcolor: '#fff',
      font: { family: '"Segoe UI", "Microsoft YaHei", sans-serif', color: '#9a9aa0', size: 11 },
      annotations: [Object.assign({ text: pass ? '<b>PASS</b>' : '<b>FAIL</b>' }, badge)],
      legend: { x: 0.01, y: 0.99, bgcolor: 'rgba(255,255,255,0.85)', bordercolor: '#e4e4e8', borderwidth: 1 },
    };
    Plotly.newPlot(divId, traces, layout, { responsive: true });
  }

  function renderExtPlot(viz) {
    const Lm = viz.mirrors[0], Rm = viz.mirrors[1];
    renderExtMirrorView('ext-plot-left', Lm, Lm.mirrorPass);
    renderExtMirrorView('ext-plot-right', Rm, Rm.mirrorPass);
    $('ext-panel-left').textContent = Lm.mirrorPass ? '✅ PASS' : '❌ FAIL';
    $('ext-panel-right').textContent = Rm.mirrorPass ? '✅ PASS' : '❌ FAIL';
  }
})();

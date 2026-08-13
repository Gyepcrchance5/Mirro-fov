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
  let curFarDist = 60.0;   // 当前车型法规远距 (auto-search 用, 默认 GB 15084 60m)
  let curReqWidth = 20.0;  // 当前车型法规远距宽度 (默认 20m)
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

  // ====== 页面路由 (landing / mirror-type / inner / exterior / wizard) ======
  // wizardMode: 'verify' 或 'new' — 决定镜子类型选择后进校核页还是向导
  let wizardMode = 'verify';
  const pages = {
    landing: $('landing-page'),
    'mirror-type': $('mirror-type-page'),
    inner: $('inner-page'),
    exterior: $('exterior-page'),
    'wizard-inner': $('wizard-inner-page'),
    'wizard-exterior': $('wizard-exterior-page'),
    'wizard-interior': $('wizard-interior-page'),
  };
  function showPage(name) {
    Object.entries(pages).forEach(([k, el]) => {
      if (el) el.style.display = k === name ? '' : 'none';
    });
    if (name === 'inner' && !pages.inner.__inited) {
      pages.inner.__inited = true;
      initInner();
    }
    if (name === 'exterior' && !pages.exterior.__inited) {
      pages.exterior.__inited = true;
      initExterior();
    }
    if (name === 'wizard-inner' && !$('wizard-inner-page').__inited) {
      $('wizard-inner-page').__inited = true;
      initWizardInner();
    }
    if (name === 'wizard-exterior' && !$('wizard-exterior-page').__inited) {
      $('wizard-exterior-page').__inited = true;
      initWizardExterior();
    }
    if (name === 'wizard-interior' && !$('wizard-interior-page').__inited) {
      $('wizard-interior-page').__inited = true;
      initWizardInterior();
    }
    if (name === 'landing') wizardMode = 'verify';
  }

  // Landing 动作优先: 校核/新建 → 镜子类型选择
  $('enter-verify-btn').addEventListener('click', () => {
    wizardMode = 'verify';
    $('type-title').textContent = '选择镜子类型 · 校核已有车型';
    showPage('mirror-type');
  });
  $('enter-new-btn').addEventListener('click', () => {
    wizardMode = 'new';
    $('type-title').textContent = '选择镜子类型 · 新建车型';
    showPage('mirror-type');
  });
  $('type-back-btn').addEventListener('click', () => showPage('landing'));
  $('select-inner-btn').addEventListener('click', () => {
    if (wizardMode === 'new') showPage('wizard-interior');
    else showPage('inner');
  });
  $('select-exterior-btn').addEventListener('click', () => {
    if (wizardMode === 'new') showPage('wizard-exterior');
    else showPage('exterior');
  });
  $('back-btn').addEventListener('click', () => showPage('mirror-type'));
  $('ext-back-btn').addEventListener('click', () => showPage('mirror-type'));

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
    // 留白 10mm; 图表高度由内容比例 + 容器宽度计算 —— 不能用 CSS aspect-ratio
    // (Plotly 渲染时 CSS 高度可能未解析 → 0 高度 → 图表不显示)
    const pad = 10;

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
    // 显式高度: 容器宽度 / 内容比例 → Plotly 渲染时拿到像素值
    // (不能用 CSS aspect-ratio — Plotly 初始化时 CSS 高度可能未解析)
    const viewEl = $('mirror-view');
    if (viewEl) {
      const w = viewEl.parentElement.clientWidth - 20; // panel-frame padding
      const contentRatio = (hw * 2 + pad * 2) / (hh * 2 + pad * 2);
      viewEl.style.height = Math.max(120, Math.round(w / contentRatio)) + 'px';
    }
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
    // 画幅范围: padding 按短边 15% (下限 10mm); 显式高度 → 内容填满无变形无留白
    const rwW = Math.max(...xs) - Math.min(...xs);
    const rwH = Math.max(...ys) - Math.min(...ys);
    const pad = Math.max(10, Math.min(rwW, rwH) * 0.15);
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
    // 显式高度: 容器宽度 / 内容比例 → 填满无变形无留白
    const rwEl = $('rear-window-view');
    if (rwEl) {
      const rwCw = rwEl.parentElement.clientWidth - 20;
      const ratio = (rwW + pad * 2) / (rwH + pad * 2);
      rwEl.style.height = Math.max(120, Math.round(rwCw / ratio)) + 'px';
    }
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
        farDist: curFarDist, reqWidth: curReqWidth,
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
    // 先清空 STEP 轮廓 (防止上一个车型的数据残留)
    currentOutlineLocal = null;
    currentRwOutline = null;
    const cfg = await callJson('/config?path=' + encodeURIComponent(path || ''));
    console.log('[loadVehicleConfig]', cfg.name, 'outlineLocal:', cfg.outlineLocal?.length||'null', 'rwOutlineFull:', cfg.rwOutlineFull?.length||'null');
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
    // 记录法规参数, 供 auto-search 带上 (不同车型可能非 60/20)
    curFarDist = Number.isFinite(cfg.farDist) ? cfg.farDist : 60.0;
    curReqWidth = Number.isFinite(cfg.reqWidth) ? cfg.reqWidth : 20.0;
    elLastAngles.textContent = `已加载车型: ${cfg.name}`;
    // 参数卡只读逻辑: 有 STEP 轮廓时, 镜面尺寸/后挡风 CAS 卡只读
    updateReadonlyState(cfg);
  }

  // 有 STEP 轮廓时, 相关参数卡只读 (轮廓已定义形状, 编辑会破坏一致性)
  function updateReadonlyState(cfg) {
    const hasOutline = !!cfg.outlineLocal;
    const hasRwOutline = !!cfg.rwOutlineFull;
    // 镜面尺寸卡 (width/height/corner-r): 有镜面轮廓则只读
    ['width', 'height', 'corner-r'].forEach(id => {
      const el = $(id);
      if (el) { el.readOnly = hasOutline; el.style.opacity = hasOutline ? '0.6' : ''; }
    });
    // 尺寸卡副标题
    const sizeHeader = document.querySelector('#param-row .col:nth-child(2) .card-header small');
    if (sizeHeader) sizeHeader.textContent = hasOutline ? `STEP ${cfg.outlineLocal.length} 点轮廓` : '反射涂层有效区域';
    // 后挡风 CAS 卡: 有后挡风轮廓则只读
    for (let i = 0; i < 7; i++) {
      ['x', 'y', 'z'].forEach(ax => {
        const el = $('rw-c' + i + '-' + ax);
        if (el) { el.readOnly = hasRwOutline; el.style.opacity = hasRwOutline ? '0.6' : ''; }
      });
    }
    const rwTitle = $('rw-section-title');
    if (rwTitle) rwTitle.textContent = hasRwOutline ? `后挡风 STEP ${cfg.rwOutlineFull.length} 点轮廓` : '后挡风 CAS 轮廓 (7 点)';
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

  // 外镜 STEP 上传一键提取: 原始二进制上传 → 自动出车型 → 校核渲染 (无需 3DE)
  async function doExtUpload() {
    const input = $('ext-upload-input');
    const file = input.files && input.files[0];
    if (!file) return;
    const btn = $('ext-upload-btn');
    btn.disabled = true; btn.textContent = '提取中…'; $('ext-status').textContent = '';
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    // 轮询提取进度 (文件名键与服务端 sanitize 一致)
    const poll = setInterval(async () => {
      try {
        const r = await fetch('api/exterior/extract/progress?name=' + encodeURIComponent(safeName));
        const d = await r.json();
        if (d.progress) $('ext-status').textContent = d.progress;
      } catch (e) { /* 轮询失败忽略, 主请求结果为准 */ }
    }, 500);
    try {
      $('ext-status').textContent = `上传 ${(file.size / 1048576).toFixed(1)}MB, 提取外镜中...`;
      const r = await fetch('api/exterior/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
        body: file,
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      await loadExtVehicles();
      await loadExtConfig(d.path);
      await doExtVerify();
      $('ext-status').textContent = '提取完成: ' + String(d.path || '').split(/[\\/]/).pop();
    } catch (e) {
      $('ext-status').textContent = '上传提取失败: ' + e.message;
    } finally {
      clearInterval(poll);
      btn.disabled = false; btn.textContent = '上传整车STEP';
    }
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

  // ====== 共享 DOM 初始化 (内镜页: 后挡风卡行 + 按钮事件绑定) ======
  // 提取为共享函数, initInner 和 saveNewVehicle 两处调用 (消除 30 行复制)
  function initInnerDOM() {
    buildRWCard('rw-row', 'rw-c', '后挡风 CAS 角', 7, RW_LABELS);
    buildRWCard('tz-row', 'rw-t', '后挡风 透光角', 4, ['透光角1', '透光角2', '透光角3', '透光角4']);
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
    checkCatiaAvailability().then(ok => { if (!ok) { $('catia-btn').disabled = true; $('catia-btn').title = '平台环境不支持 3DE 读取, 请本地使用'; $('catia-btn').textContent = '3DE不可用'; } });
    $('vehicle-select').addEventListener('change', async (e) => {
      await loadVehicleConfig(e.target.value);
      await doVerify();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && pages.inner.style.display !== 'none') doVerify();
    });
  }

  // ====== 内镜页初始化 (首次进入时调用) ======
  async function initInner() {
    initInnerDOM();
    await loadVehicles();
    await loadVehicleConfig($('vehicle-select').value);
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
  let extRawConfig = null; // 完整外镜 JSON (含 outline_raw + 轴线), 保存时原样回传
  // DOM 绑定 (不含自动加载): 向导保存后跳校核页时只绑定一次, 避免自动加载与新车型加载产生异步竞态
  function initExteriorDOM() {
    $('ext-verify-btn').addEventListener('click', doExtVerify);
    $('ext-auto-btn').addEventListener('click', doExtAuto);
    $('ext-vehicle-select').addEventListener('change', async (e) => {
      await loadExtConfig(e.target.value);
      await doExtVerify();
    });
    // 顶栏操作 (外镜 3DE 读取 / STEP 上传一键提取 — 按钮已隐藏, 函数保留)
    $('ext-catia-btn').addEventListener('click', doExtCatia);
    $('ext-upload-btn').addEventListener('click', () => $('ext-upload-input').click());
    $('ext-upload-input').addEventListener('change', doExtUpload);
    checkCatiaAvailability().then(ok => { if (!ok) { $('ext-catia-btn').disabled = true; $('ext-catia-btn').title = '平台环境不支持 3DE 读取, 请本地使用'; $('ext-catia-btn').textContent = '3DE不可用'; } });
    $('ext-save-btn').addEventListener('click', doExtSave);
    $('ext-save-as-btn').addEventListener('click', doExtSaveAs);
    $('ext-delete-btn').addEventListener('click', doExtDelete);
    // 轴线方向输入实时回显补录提示 (输入过程中即时更新默认轴/真轴状态)
    ['L', 'R'].forEach(side => {
      ['x', 'y', 'z'].forEach(ax => {
        $('ext-axis-' + side + '-' + ax).addEventListener('input', () => {
          const v = ['x', 'y', 'z'].map(a => parseFloat($('ext-axis-' + side + '-' + a).value));
          if (v.every(n => Number.isFinite(n))) setExtAxisHint(side, v);
        });
      });
    });
  }
  function initExterior() {
    initExteriorDOM();
    loadExtVehicles().then(() => loadExtConfig($('ext-vehicle-select').value).then(() => doExtVerify()));
  }

  // ====== 内后视镜新建向导 ======
  const wizardData = { name: '', mirrorOutline: null, rwOutline: null };

  function wizardNext(current) {
    document.querySelector('.wizard-step[data-step="' + current + '"]').style.display = 'none';
    document.querySelector('.wizard-step[data-step="' + (current + 1) + '"]').style.display = '';
  }
  function wizardPrev(current) {
    document.querySelector('.wizard-step[data-step="' + current + '"]').style.display = 'none';
    document.querySelector('.wizard-step[data-step="' + (current - 1) + '"]').style.display = '';
  }

  // 动态生成 Step 2 点坐标输入卡 (5 个点, 结构同校核页参数卡)
  const WIZ_POINTS = [
    { id: 'pvt', label: '球铰 pivot', default: [2883.07, 0, 1441.017] },
    { id: 'cz', label: '镜面中心', default: [2909.215, 0.007, 1441.88] },
    { id: 'eye', label: '眼点中心', default: [3243.09, -385, 1372] },
    { id: 'gf', label: '地面前端', default: [500, 0, 193.209] },
    { id: 'gr', label: '地面后端', default: [5900, 0, 193.209] },
  ];
  function buildWizardPoints() {
    const grid = $('wiz-points-grid');
    grid.innerHTML = '';
    for (const pt of WIZ_POINTS) {
      const col = document.createElement('div');
      col.className = 'col-6 col-md-6';
      const axes = ['X', 'Y', 'Z'];
      col.innerHTML = `
        <div class="card shadow-sm h-100">
          <div class="card-header py-1 px-2"><div class="card-title mb-0">${pt.label}</div></div>
          <div class="card-body py-2 px-2">
            ${axes.map((ax, i) => `<div class="mb-2"><label class="mb-0" style="font-size:13px">${ax} </label><small class="unit">mm</small><input id="wiz-${pt.id}-${ax.toLowerCase()}" type="number" step="any" class="form-control form-control-sm" value="${pt.default[i]}"></div>`).join('')}
          </div>
        </div>`;
      grid.appendChild(col);
    }
  }

  // STEP 上传 + 解析 + 预览
  // 直接以原始二进制上传 (非 base64 JSON): 无编码开销/不冻结主线程, 体积少 33%, 本地秒传
  async function parseStepFile(fileInput, resultDiv, type) {
    const file = fileInput.files[0];
    if (!file) { resultDiv.className = 'wizard-result'; resultDiv.textContent = '请先选择文件'; return; }
    const parseBtn = $('wiz-parse-' + (type === 'mirror' ? 'mirror' : 'rw'));
    if (parseBtn) parseBtn.disabled = true;
    resultDiv.className = 'wizard-result';
    try {
      resultDiv.textContent = `上传 ${(file.size / 1048576).toFixed(1)}MB, 解析轮廓中...`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120000);
      // 轮询提取进度 (文件名键与服务端 sanitize 一致)
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const poll = setInterval(async () => {
        try {
          const r = await fetch(API_BASE + '/step/progress?name=' + encodeURIComponent(safeName));
          const d = await r.json();
          if (d.progress) resultDiv.textContent = d.progress;
        } catch (e) { /* 轮询失败忽略, 主请求结果为准 */ }
      }, 500);
      let resp;
      try {
        resp = await fetch(API_BASE + '/step/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Filename': encodeURIComponent(file.name),
            'X-Type': type,
          },
          body: file,
          signal: controller.signal,
        });
      } finally { clearTimeout(timer); clearInterval(poll); }
      const data = await resp.json();
      if (data.ok) {
        resultDiv.className = 'wizard-result ok';
        resultDiv.textContent = `提取 ${data.outline_count} 点轮廓`;
        if (type === 'mirror') {
          wizardData.mirrorOutline = data.outline;
          renderWizardPreview('wiz-mirror-plot', 'wiz-mirror-preview', data.outline, '镜面轮廓');
        } else {
          wizardData.rwOutline = data.outline;
          renderWizardPreview('wiz-rw-plot', 'wiz-rw-preview', data.outline, '后挡风轮廓');
        }
      } else {
        resultDiv.className = 'wizard-result err';
        resultDiv.textContent = `失败: ${data.error}`;
      }
    } catch (err) {
      resultDiv.className = 'wizard-result err';
      resultDiv.textContent = err.name === 'AbortError' ? '解析超时 (120 秒), 请重试或确认 STEP 文件类型' : `失败: ${err.message}`;
    } finally {
      if (parseBtn) parseBtn.disabled = false;
    }
  }

  // 轮廓预览 (Plotly 2D, 后挡风用 Y-Z, 镜面用 u-v)
  function renderWizardPreview(plotDiv, previewDiv, outline, title) {
    if (typeof Plotly === 'undefined' || !outline || outline.length < 3) return;
    const is2D = outline[0].length === 2;
    const xs = outline.map(p => is2D ? p[0] : p[1]);
    const ys = outline.map(p => is2D ? p[1] : p[2]);
    xs.push(xs[0]); ys.push(ys[0]);
    $(previewDiv).style.display = '';
    Plotly.newPlot(plotDiv, [{
      x: xs, y: ys, mode: 'lines+markers',
      line: { color: '#0071e3', width: 2 },
      marker: { size: 3, color: '#0071e3' },
      fill: 'toself', fillcolor: 'rgba(0,113,227,0.08)',
    }], {
      xaxis: { title: 'u (mm)', gridcolor: '#f0f0f2' },
      yaxis: { title: 'v (mm)', gridcolor: '#f0f0f2' },
      margin: { l: 50, r: 10, t: 24, b: 40 },
      paper_bgcolor: '#fff', plot_bgcolor: '#fff',
      font: { family: '"Segoe UI", "Microsoft YaHei", sans-serif', color: '#9a9aa0', size: 11 },
      title: { text: title + ' · ' + outline.length + ' 点', font: { size: 12, color: '#6e6e73' } },
    }, { responsive: true });
  }

  // 3DE 读取点坐标 (复用 doCatia 流程)
  async function doWizCatia() {
    const btn = $('wiz-catia-btn');
    if (!confirm('将从 3DE 读取点坐标。\n\n请在运行本服务的终端窗口中完成选点。\n\n确定开始？')) return;
    btn.disabled = true; btn.textContent = '读取中…';
    try {
      const r = await fetch(API_BASE + '/catia', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      // 读到的车型配置, 填充向导点坐标 (从 JSON 文件读)
      const cfg = await (await fetch(API_BASE + '/config?path=' + encodeURIComponent(d.output))).json();
      fillWizardPointsFromConfig(cfg);
      alert('已从 3DE 读取并填充点坐标。请确认后继续。');
    } catch (e) {
      alert('3DE 读取失败: ' + e.message + '\n\n请确认 3DE 已启动、Python/pywin32 已装、并在服务终端完成操作。');
    } finally { btn.disabled = false; btn.textContent = '从 3DE 读取'; }
  }

  function fillWizardPointsFromConfig(cfg) {
    const map = { 'pvt-x': 'pvMM', 'pvt-y': 'pvMM', 'pvt-z': 'pvMM',
                  'cz-x': 'czMM', 'cz-y': 'czMM', 'cz-z': 'czMM',
                  'eye-x': 'eyeMM', 'eye-y': 'eyeMM', 'eye-z': 'eyeMM',
                  'gf-x': 'gfMM', 'gf-y': 'gfMM', 'gf-z': 'gfMM',
                  'gr-x': 'grMM', 'gr-y': 'grMM', 'gr-z': 'grMM' };
    for (const [wizId, cfgField] of Object.entries(map)) {
      const el = $('wiz-' + wizId);
      if (el && cfg[cfgField]) {
        const idx = { x: 0, y: 1, z: 2 }[wizId.slice(-1)];
        el.value = cfg[cfgField][idx];
      }
    }
    if (cfg.yawDeg != null) $('wiz-yaw').value = cfg.yawDeg;
    if (cfg.pitchDeg != null) $('wiz-pitch').value = cfg.pitchDeg;
    if (cfg.cornerRadiusMM != null) $('wiz-corner').value = cfg.cornerRadiusMM;
    if (cfg.ipdMM != null) $('wiz-ipd').value = cfg.ipdMM;
  }

  // 保存新车型 → 切校核页
  async function saveNewVehicle() {
    const name = ($('wiz-name').value || '新车型').trim();
    // parseFloat 空值兜底: 空串/NaN→0, 避免 JSON.stringify 转 null 污染数据 (P0)
    const pf = (id, def) => { const v = parseFloat($('wiz-' + id).value); return isNaN(v) ? def : v; };
    const pf3 = (id, def) => [$('wiz-' + id + '-x'), $('wiz-' + id + '-y'), $('wiz-' + id + '-z')].map(el => { const v = parseFloat(el.value); return isNaN(v) ? 0 : v; });
    const gfZ = pf('gf-z', 0);
    // 镜面尺寸: 有 STEP 轮廓时读取真实跨度的 floor 值, 否则默认
    const w = wizardData.mirrorOutline && wizardData.mirrorOutline.length >= 3
      ? Math.floor(Math.max(...wizardData.mirrorOutline.map(p => p[0])) - Math.min(...wizardData.mirrorOutline.map(p => p[0]))) || 224.796 : 224.796;
    const h = wizardData.mirrorOutline && wizardData.mirrorOutline.length >= 3
      ? Math.floor(Math.max(...wizardData.mirrorOutline.map(p => p[1])) - Math.min(...wizardData.mirrorOutline.map(p => p[1]))) || 50.794 : 50.794;
    // 后挡风: 无 STEP 时用 7 点占位 (与系统预期 7 行对齐, 不 pad 重复点)
    const defaultRw = wizardData.rwOutline && wizardData.rwOutline.length >= 3 ? [[...wizardData.rwOutline[0]]] : [
      [4.54, -0.57, 1.49], [4.71, -0.51, 1.45], [4.71, 0.51, 1.45], [4.54, 0.57, 1.49],
      [4.54, 0.57, 1.49], [4.54, -0.57, 1.49], [4.54, -0.57, 1.49]];
    const payload = {
      name,
      widthMM: w, heightMM: h,
      cornerRadiusMM: pf('corner', 10),
      yawDeg: pf('yaw', -23.5),
      pitchDeg: pf('pitch', 5.0),
      pvMM: pf3('pvt'),
      czMM: pf3('cz'),
      eyeMM: pf3('eye'),
      ipdMM: pf('ipd', 65),
      gfMM: [pf('gf-x', 0), pf('gf-y', 0), gfZ],
      grMM: [pf('gr-x', 0), pf('gr-y', 0), pf('gr-z', 0)],
      groundZ: gfZ / 1000,
      rwMM: defaultRw,
      rwTMM: [],
    };

    try {
      // 1. 保存车型 JSON (复用现有 save 接口)
      const resp = await fetch(API_BASE + '/vehicles/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await resp.json();
      if (!d.ok) throw new Error(d.error);

      // 2. 如有 STEP 轮廓, 保存 outline 文件并设 outline_path
      if (wizardData.mirrorOutline || wizardData.rwOutline) {
        await saveWizardOutlines(name, d.path);
      }

      // 3. 切校核页: 需确保内镜页 DOM 就绪 (后挡风 7 点行等), 但不触发 auto-load;
      //    initInner 内部的 loadVehicleConfig+doVerify 会与下面的加载产生异步竞态
      //    (initInner 的 doVerify 晚到达 → 覆盖新车型渲染)
      if (!pages.inner.__inited) {
        pages.inner.__inited = true;
        initInnerDOM();
      }
      // 始终刷新下拉并选中新车型 (此前已 inited 时下拉是旧列表, 新车型不在其中)
      await loadVehicles();
      $('vehicle-select').value = d.path;
      showPage('inner');
      await loadVehicleConfig(d.path);
      await doVerify();
    } catch (e) {
      alert('保存失败: ' + e.message);
    }
  }

  // 保存向导提取的轮廓到 data/vehicles/<name>.*.json 并更新车型 outline_path
  async function saveWizardOutlines(name, vehiclePath) {
    const safe = name.replace(/[\\/:*?"<>|]/g, '_');
    // 镜面轮廓 (outline_local_mm, 供 isOnReflectiveSurface)
    if (wizardData.mirrorOutline) {
      const local = wizardData.mirrorOutline; // [u,v] mm 已由后端转换
      const outlineFile = { source: 'wizard_step', outline_local_mm: local, outline_count: local.length, unit: 'mm' };
      const saveResp = await fetch(API_BASE + '/vehicles/save-outline', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehiclePath, kind: 'mirror', outlineFile }),
      });
      const sd = await saveResp.json();
      if (!sd.ok) throw new Error(sd.error);
    }
    // 后挡风轮廓 (outline_mm, 3D)
    if (wizardData.rwOutline) {
      const saveResp = await fetch(API_BASE + '/vehicles/save-outline', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehiclePath, kind: 'rear-window', outlineFile: { source: 'wizard_step', outline_mm: wizardData.rwOutline, outline_count: wizardData.rwOutline.length, unit: 'mm' } }),
      });
      const sd = await saveResp.json();
      if (!sd.ok) throw new Error(sd.error);
    }
  }

  function initWizardInner() {
    buildWizardPoints();
    $('wiz-inner-back').addEventListener('click', () => showPage('mirror-type'));
    $('wiz-step0-next').addEventListener('click', () => { wizardData.name = $('wiz-name').value || '新车型'; wizardNext(0); });
    $('wiz-step1-prev').addEventListener('click', () => wizardPrev(1));
    $('wiz-step1-next').addEventListener('click', () => wizardNext(1));
    $('wiz-step2-prev').addEventListener('click', () => wizardPrev(2));
    $('wiz-step2-next').addEventListener('click', () => wizardNext(2));
    $('wiz-step3-prev').addEventListener('click', () => wizardPrev(3));
    $('wiz-parse-mirror').addEventListener('click', () => parseStepFile($('wiz-mirror-step'), $('wiz-mirror-result'), 'mirror'));
    $('wiz-parse-rw').addEventListener('click', () => parseStepFile($('wiz-rw-step'), $('wiz-rw-result'), 'rear-window'));
    // 选完文件立即自动解析 (无需再点按钮); 按钮保留作"重新解析"
    $('wiz-mirror-step').addEventListener('change', () => parseStepFile($('wiz-mirror-step'), $('wiz-mirror-result'), 'mirror'));
    $('wiz-rw-step').addEventListener('change', () => parseStepFile($('wiz-rw-step'), $('wiz-rw-result'), 'rear-window'));
    $('wiz-catia-btn').addEventListener('click', doWizCatia);
    $('wiz-save-btn').addEventListener('click', saveNewVehicle);
  }

  // ====== 外后视镜新建向导 (阶段 5) ======
  let wizExtPath = null;    // 提取结果 tmp 路径 (data/tmp/<stem>.json)
  let wizExtRaw = null;     // 提取的完整外镜 JSON (保存时深拷贝 patch 轴线)

  // 步骤导航 (作用域限定在 wizard-exterior-page, 避免与内镜向导的 .wizard-step 冲突)
  function wizardExtNext(current) {
    $('wizard-exterior-page').querySelector('.wizard-step[data-step="' + current + '"]').style.display = 'none';
    $('wizard-exterior-page').querySelector('.wizard-step[data-step="' + (current + 1) + '"]').style.display = '';
  }
  function wizardExtPrev(current) {
    $('wizard-exterior-page').querySelector('.wizard-step[data-step="' + current + '"]').style.display = 'none';
    $('wizard-exterior-page').querySelector('.wizard-step[data-step="' + (current - 1) + '"]').style.display = '';
  }

  // 读取某侧旋转轴方向输入, 非法 (NaN/零向量) 返回 null
  function readWizExtAxis(side) {
    const v = ['x', 'y', 'z'].map(ax => parseFloat($('wiz-ext-axis-' + side + '-' + ax).value));
    if (v.some(n => !Number.isFinite(n))) return null;
    if (Math.hypot(v[0], v[1], v[2]) < 1e-9) return null;
    return v;
  }

  // 向导轴线提示 (默认 [0,1,0] 橙色警告; 手填真轴变灰; STEP 自动提取变灰并标注来源)
  function isWizExtDefaultAxis(dir) {
    return Array.isArray(dir) && dir.length >= 3
      && Math.abs(dir[0]) < 1e-6 && Math.abs(dir[1] - 1) < 1e-6 && Math.abs(dir[2]) < 1e-6;
  }
  function setWizExtAxisHint(side, dir, label) {
    const el = $('wiz-ext-axis-hint-' + side);
    if (!el) return;
    const isDefault = isWizExtDefaultAxis(dir);
    el.style.color = isDefault ? '#ff9f0a' : '#9a9aa0';
    el.textContent = isDefault
      ? '使用默认轴 [0,1,0], 建议补录真轴'
      : (label || '已补录真轴') + ' [' + dir.map(v => v.toFixed(4)).join(', ') + ']';
  }
  function setWizExtAxisInputs(side, dir, label) {
    if (!Array.isArray(dir) || dir.length < 3) return;
    ['x', 'y', 'z'].forEach((ax, i) => { const el = $('wiz-ext-axis-' + side + '-' + ax); if (el) el.value = dir[i]; });
    setWizExtAxisHint(side, dir, label);
  }

  // Step 1: 上传整车 STEP → 提取到 tmp → 读 config(raw) + verify(viz) → 预览左右轮廓/球面偏差/球心
  async function doWizExtUpload() {
    const input = $('wiz-ext-step');
    const file = input.files && input.files[0];
    if (!file) { $('wiz-ext-result').className = 'wizard-result'; $('wiz-ext-result').textContent = '请先选择文件'; return; }
    const btn = $('wiz-ext-upload-btn');
    btn.disabled = true; btn.textContent = '提取中…';
    const resultDiv = $('wiz-ext-result');
    resultDiv.className = 'wizard-result';
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const poll = setInterval(async () => {
      try {
        const r = await fetch('api/exterior/extract/progress?name=' + encodeURIComponent(safeName));
        const d = await r.json();
        if (d.progress) resultDiv.textContent = d.progress;
      } catch (e) { /* 轮询失败忽略 */ }
    }, 500);
    try {
      resultDiv.textContent = `上传 ${(file.size / 1048576).toFixed(1)}MB, 提取外镜中...`;
      const r = await fetch('api/exterior/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
        body: file,
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      wizExtPath = d.path;
      // raw config (含 outline_raw + 轴线 + regulation), 保存时原样回传
      const cfgR = await fetch('api/exterior/config?path=' + encodeURIComponent(d.path));
      const cfg = await cfgR.json();
      if (!cfg.ok) throw new Error(cfg.error);
      wizExtRaw = cfg.raw || null;
      // 轴线自动填入 step2 (若 STEP 含镜体坐标系 AXIS2_PLACEMENT_3D); 未提取到则保留默认 [0,1,0]+橙色警告
      const axL = cfg.mirrors && cfg.mirrors.left ? cfg.mirrors.left.rotation_axis_dir : null;
      const axR = cfg.mirrors && cfg.mirrors.right ? cfg.mirrors.right.rotation_axis_dir : null;
      if (axL && !isWizExtDefaultAxis(axL)) setWizExtAxisInputs('L', axL, '已从 STEP 自动提取');
      if (axR && !isWizExtDefaultAxis(axR)) setWizExtAxisInputs('R', axR, '已从 STEP 自动提取');
      // verify 结果: viz.mirrors[].outlineUV + left/right.fit (球面偏差/球心)
      const vR = await fetch('api/exterior/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: d.path, psi: 0 }),
      });
      const v = await vR.json();
      if (!v.ok) throw new Error(v.error);
      renderWizExtPreview(v);
      resultDiv.className = 'wizard-result ok';
      resultDiv.textContent = '提取完成';
    } catch (e) {
      resultDiv.className = 'wizard-result err';
      resultDiv.textContent = '提取失败: ' + e.message;
    } finally {
      clearInterval(poll);
      btn.disabled = false; btn.textContent = '上传并提取';
    }
  }

  // 预览: 左右 2D 轮廓 (outlineUV 闭合折线) + 球面偏差/球心标注 (只画轮廓, 不画投影/安全线)
  function renderWizExtPreview(v) {
    if (typeof Plotly === 'undefined') return;
    const mirs = (v.viz && v.viz.mirrors) || [];
    const leftMir = mirs.find(m => m.side === 'left') || mirs[0];
    const rightMir = mirs.find(m => m.side === 'right') || mirs[1];
    // 关键: 先显示容器再画 — Plotly 在 display:none 的容器里渲染会拿到 0 尺寸 → 图坍缩成一半
    // (同 commit 942422b 的 Plotly 隐藏渲染 bug)
    $('wiz-ext-preview').style.display = '';
    const draw = (plotDiv, fitDiv, M, fit, label) => {
      if (!M || !Array.isArray(M.outlineUV) || M.outlineUV.length < 3) { $(fitDiv).textContent = label + ': 无轮廓'; return; }
      const ol = M.outlineUV;
      const xs = ol.map(p => p[0]), ys = ol.map(p => p[1]);
      const uMin = Math.min(...xs), uMax = Math.max(...xs), vMin = Math.min(...ys), vMax = Math.max(...ys);
      // 等比例 + 显式 range: 对齐校核页 renderExtMirrorView, 否则 u 跨度>v 跨度时形状被压扁
      const pad = Math.max(uMax - uMin, vMax - vMin) * 0.15;
      xs.push(xs[0]); ys.push(ys[0]);
      Plotly.newPlot(plotDiv, [{
        x: xs, y: ys, mode: 'lines+markers',
        line: { color: '#0071e3', width: 2 },
        marker: { size: 3, color: '#0071e3' },
        fill: 'toself', fillcolor: 'rgba(0,113,227,0.08)',
      }], {
        xaxis: { title: 'u (mm)', range: [uMin - pad, uMax + pad], scaleanchor: 'y', scaleratio: 1, gridcolor: '#f0f0f2', zerolinecolor: '#e4e4e8' },
        yaxis: { title: 'v (mm)', range: [vMin - pad, vMax + pad], gridcolor: '#f0f0f2', zerolinecolor: '#e4e4e8' },
        margin: { l: 50, r: 10, t: 24, b: 40 },
        paper_bgcolor: '#fff', plot_bgcolor: '#fff',
        font: { family: '"Segoe UI", "Microsoft YaHei", sans-serif', color: '#9a9aa0', size: 11 },
        title: { text: label + ' · ' + ol.length + ' 点', font: { size: 12, color: '#6e6e73' } },
      }, { responsive: true });
      const dev = fit && fit.gate && Number.isFinite(fit.gate.maxDevMm) ? fit.gate.maxDevMm.toFixed(3) : '-';
      const c = fit && Array.isArray(fit.center) ? fit.center.map(x => Number.isFinite(x) ? x.toFixed(2) : '-').join(', ') : '-';
      $(fitDiv).textContent = label + ' · 球面偏差 ' + dev + 'mm · 球心[' + c + ']';
    };
    draw('wiz-ext-plot-left', 'wiz-ext-fit-left', leftMir, v.left && v.left.fit, '左镜轮廓');
    draw('wiz-ext-plot-right', 'wiz-ext-fit-right', rightMir, v.right && v.right.fit, '右镜轮廓');
  }

  // Step 2: 从 3DE 读取轴线方向 (仅取 rotation_axis_dir; 无 CATIA 环境时失败提示不崩)
  async function wizExtReadFrom3DE() {
    const btn = $('wiz-ext-catia-btn');
    if (!confirm('将从 3DE 读取外镜旋转轴方向。\n\n请在运行本服务的终端窗口中完成选点。\n\n确定开始？')) return;
    btn.disabled = true; btn.textContent = '3DE读取中…';
    try {
      const r = await fetch('api/catia/exterior', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      const cfg = await (await fetch('api/exterior/config?path=' + encodeURIComponent(d.output))).json();
      if (!cfg.ok) throw new Error(cfg.error);
      const L = cfg.mirrors && cfg.mirrors.left ? cfg.mirrors.left.rotation_axis_dir : null;
      const R = cfg.mirrors && cfg.mirrors.right ? cfg.mirrors.right.rotation_axis_dir : null;
      if (L) setWizExtAxisInputs('L', L);
      if (R) setWizExtAxisInputs('R', R);
      alert('已从 3DE 读取并填充旋转轴方向。请确认后继续。');
    } catch (e) {
      alert('3DE 读取失败: ' + e.message + '\n\n无 CATIA 环境时会失败, 可改用手动填写轴线。');
    } finally { btn.disabled = false; btn.textContent = '从 3DE 读取'; }
  }

  // Step 3: 保存并校核 — 深拷贝 step1 raw, patch 轴线 + vehicle.name, POST /api/exterior/save
  async function doWizExtSave() {
    const btn = $('wiz-ext-save-btn');
    const name = ($('wiz-ext-name').value || '新外镜车型').trim();
    if (!wizExtRaw) { alert('请先完成整车 STEP 提取'); return; }
    const axisL = readWizExtAxis('L'), axisR = readWizExtAxis('R');
    if (!axisL || !axisR) { alert('旋转轴方向向量非法 (需非零 3 维向量)'); return; }
    btn.disabled = true; btn.textContent = '保存中…';
    try {
      const config = JSON.parse(JSON.stringify(wizExtRaw));
      if (!config.exterior_mirror_left) config.exterior_mirror_left = {};
      if (!config.exterior_mirror_right) config.exterior_mirror_right = {};
      config.exterior_mirror_left.rotation_axis_dir = axisL;
      config.exterior_mirror_right.rotation_axis_dir = axisR;
      if (!config.vehicle) config.vehicle = {};
      config.vehicle.name = name;
      const r = await fetch('api/exterior/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, config }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      // 跳校核页: 只绑定一次 DOM (不触发自动加载, 避免竞态), 再显式加载新车型
      if (!pages.exterior.__inited) {
        pages.exterior.__inited = true;
        initExteriorDOM();
      }
      await loadExtVehicles();
      $('ext-vehicle-select').value = d.path;
      await loadExtConfig(d.path);
      await doExtVerify();
      showPage('exterior');
    } catch (e) {
      alert('保存失败: ' + e.message);
    } finally { btn.disabled = false; btn.textContent = '保存并校核'; }
  }

  function initWizardExterior() {
    $('wiz-ext-back').addEventListener('click', () => showPage('mirror-type'));
    $('wiz-ext-step0-next').addEventListener('click', () => wizardExtNext(0));
    $('wiz-ext-step1-prev').addEventListener('click', () => wizardExtPrev(1));
    $('wiz-ext-step1-next').addEventListener('click', () => wizardExtNext(1));
    $('wiz-ext-step2-prev').addEventListener('click', () => wizardExtPrev(2));
    $('wiz-ext-step2-next').addEventListener('click', () => wizardExtNext(2));
    $('wiz-ext-step3-prev').addEventListener('click', () => wizardExtPrev(3));
    $('wiz-ext-upload-btn').addEventListener('click', () => doWizExtUpload());
    $('wiz-ext-step').addEventListener('change', () => doWizExtUpload());
    $('wiz-ext-catia-btn').addEventListener('click', wizExtReadFrom3DE);
    $('wiz-ext-save-btn').addEventListener('click', doWizExtSave);
    ['L', 'R'].forEach(side => {
      ['x', 'y', 'z'].forEach(ax => {
        $('wiz-ext-axis-' + side + '-' + ax).addEventListener('input', () => {
          const v = ['x', 'y', 'z'].map(a => parseFloat($('wiz-ext-axis-' + side + '-' + a).value));
          if (v.every(n => Number.isFinite(n))) setWizExtAxisHint(side, v);
        });
      });
    });
    setWizExtAxisHint('L', [0, 1, 0]);
    setWizExtAxisHint('R', [0, 1, 0]);
  }

  // ====== 内后视镜新建向导 (阶段 7: 一 STEP 全自动) ======
  let wizIntResult = null;  // 提取的完整内镜 JSON (modena.json 结构, 含 _meta.outline_local_mm)

  function wizardIntNext(current) {
    $('wizard-interior-page').querySelector('.wizard-step[data-step="' + current + '"]').style.display = 'none';
    $('wizard-interior-page').querySelector('.wizard-step[data-step="' + (current + 1) + '"]').style.display = '';
  }
  function wizardIntPrev(current) {
    $('wizard-interior-page').querySelector('.wizard-step[data-step="' + current + '"]').style.display = 'none';
    $('wizard-interior-page').querySelector('.wizard-step[data-step="' + (current - 1) + '"]').style.display = '';
  }

  function fmtWizIntVec(v) {
    return v && v.length >= 3 ? '[' + v.map(x => (Number.isFinite(x) ? x.toFixed(4) : '-')).join(', ') + ']' : 'null';
  }
  function wizIntSummaryHtml(r) {
    const m = r.mirror || {}, d = r.driver || {}, g = r.ground || {}, rw = r.rear_window || {};
    const missing = (r._meta && r._meta.missing_named) || [];
    const lines = [
      '镜面: 宽 ' + (m.width != null ? (m.width * 1000).toFixed(2) + 'mm' : 'null') +
        ' · 高 ' + (m.height != null ? (m.height * 1000).toFixed(2) + 'mm' : 'null'),
      '安装角: yaw ' + (m.yaw != null ? m.yaw.toFixed(2) + '°' : 'null') +
        ' · pitch ' + (m.pitch != null ? m.pitch.toFixed(2) + '°' : 'null'),
      'pivot ' + fmtWizIntVec(m.pivot) + ' · center_zero ' + fmtWizIntVec(m.center_zero),
      '眼点 ' + fmtWizIntVec(d.eye_center) + ' · IPD ' + ((d.interpupillary_distance || 0) * 1000).toFixed(1) + 'mm',
      '地面 前 ' + fmtWizIntVec(g.front_mid) + ' · 后 ' + fmtWizIntVec(g.rear_mid),
      '后挡风 ' + (rw.outline && rw.outline.length ? rw.outline.length + ' 点' : '未命名 (可空)'),
    ];
    if (missing.length) lines.push('<span style="color:#ff9f0a">缺命名: ' + missing.join('; ') + '</span>');
    return lines.join('<br>');
  }

  // Step 1: 上传整车 STEP → 提取到 tmp → 预览镜面轮廓 2D + 参数摘要
  async function doWizIntUpload() {
    const input = $('wiz-int-step');
    const file = input.files && input.files[0];
    if (!file) { $('wiz-int-result').className = 'wizard-result'; $('wiz-int-result').textContent = '请先选择文件'; return; }
    const btn = $('wiz-int-upload-btn');
    btn.disabled = true; btn.textContent = '提取中…';
    const resultDiv = $('wiz-int-result');
    resultDiv.className = 'wizard-result';
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const poll = setInterval(async () => {
      try {
        const r = await fetch('api/interior/extract/progress?name=' + encodeURIComponent(safeName));
        const d = await r.json();
        if (d.progress) resultDiv.textContent = d.progress;
      } catch (e) { /* 轮询失败忽略 */ }
    }, 500);
    try {
      resultDiv.textContent = `上传 ${(file.size / 1048576).toFixed(1)}MB, 提取内镜中...`;
      const r = await fetch('api/interior/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
        body: file,
      });
      const d = await r.json().catch(() => ({ ok: false, error: `服务器返回非 JSON (HTTP ${r.status}), 可能 STEP 过大或提取崩溃, 请查看服务终端日志` }));
      if (!d.ok) throw new Error(d.error);
      wizIntResult = d.result || null;
      if (!wizIntResult) throw new Error('提取结果为空');
      renderWizIntPreview(wizIntResult);
      $('wiz-int-confirm').innerHTML = wizIntSummaryHtml(wizIntResult);
      $('wiz-int-summary-final').innerHTML = wizIntSummaryHtml(wizIntResult);
      resultDiv.className = 'wizard-result ok';
      resultDiv.textContent = '提取完成';
    } catch (e) {
      resultDiv.className = 'wizard-result err';
      resultDiv.textContent = '提取失败: ' + e.message;
    } finally {
      clearInterval(poll);
      btn.disabled = false; btn.textContent = '上传并提取';
    }
  }

  // 预览: 镜面轮廓 2D (outline_local_mm 闭合折线) + 尺寸/安装角标注 (平面镜, 无球面偏差)
  function renderWizIntPreview(r) {
    const ol = r._meta && r._meta.outline_local_mm;
    $('wiz-int-preview').style.display = '';
    const m = r.mirror || {};
    if (typeof Plotly === 'undefined') {
      $('wiz-int-summary').innerHTML = wizIntSummaryHtml(r);
      return;
    }
    if (!ol || ol.length < 3) {
      $('wiz-int-summary').innerHTML = '无镜面轮廓 (缺 INNER_MIRROR_GLASS 命名面)。<br>' + wizIntSummaryHtml(r);
      return;
    }
    const xs = ol.map(p => p[0]), ys = ol.map(p => p[1]);
    const uMin = Math.min(...xs), uMax = Math.max(...xs), vMin = Math.min(...ys), vMax = Math.max(...ys);
    const pad = Math.max(uMax - uMin, vMax - vMin) * 0.15;
    xs.push(xs[0]); ys.push(ys[0]);
    Plotly.newPlot('wiz-int-plot', [{
      x: xs, y: ys, mode: 'lines+markers',
      line: { color: '#0071e3', width: 2 },
      marker: { size: 3, color: '#0071e3' },
      fill: 'toself', fillcolor: 'rgba(0,113,227,0.08)',
    }], {
      xaxis: { title: 'u (mm)', range: [uMin - pad, uMax + pad], scaleanchor: 'y', scaleratio: 1, gridcolor: '#f0f0f2', zerolinecolor: '#e4e4e8' },
      yaxis: { title: 'v (mm)', range: [vMin - pad, vMax + pad], gridcolor: '#f0f0f2', zerolinecolor: '#e4e4e8' },
      margin: { l: 50, r: 10, t: 24, b: 40 },
      paper_bgcolor: '#fff', plot_bgcolor: '#fff',
      font: { family: '"Segoe UI", "Microsoft YaHei", sans-serif', color: '#9a9aa0', size: 11 },
      title: { text: '内镜轮廓 · ' + ol.length + ' 点', font: { size: 12, color: '#6e6e73' } },
    }, { responsive: true });
    $('wiz-int-summary').innerHTML = wizIntSummaryHtml(r);
  }

  // Step 3: 保存并校核 — 提取 JSON → 扁平字段 → /api/vehicles/save + save-outline → 跳 inner-page
  async function doWizIntSave() {
    const name = ($('wiz-int-name').value || '新内镜车型').trim();
    if (!wizIntResult) { alert('请先完成整车 STEP 提取'); return; }
    const r = wizIntResult;
    const m = r.mirror || {}, d = r.driver || {}, g = r.ground || {}, rw = r.rear_window || {};
    // 关键参数缺失防护: pivot/center_zero 缺命名时不能兜底 0 (会静默存错数据 → 校核全错)。
    // modena 等未命名 STEP 走到这里应阻止保存, 提示补命名。
    if (!m.pivot || !m.center_zero) {
      alert('提取缺 pivot 或 center_zero (STEP 未含 MIRROR_PIVOT / MIRROR_CENTER_ZERO 命名点), 无法保存校核。\n\n请让供应商按内镜规范补这两个命名点后重试。\n(眼点/镜面轮廓/地面/yaw·pitch 已自动提取, 仅缺球铰与零位中心。)');
      return;
    }
    const mm = v => (v && v.length >= 3) ? [v[0] * 1000, v[1] * 1000, v[2] * 1000] : [0, 0, 0];
    // 后挡风默认 4 点占位 (与 modena 一致; 无 REAR_WINDOW 命名时用)
    const defaultRw = [[4.541629, -0.571227, 1.491361], [5.120844, -0.538903, 1.293511], [5.120844, 0.538903, 1.293511], [4.541629, 0.571227, 1.491361]];
    const rwOutline = rw.outline && rw.outline.length >= 3 ? rw.outline : defaultRw;
    const payload = {
      name,
      widthMM: m.width != null ? m.width * 1000 : 224.796,
      heightMM: m.height != null ? m.height * 1000 : 50.794,
      cornerRadiusMM: (m.corner_radius || 0.01) * 1000,
      yawDeg: m.yaw != null ? m.yaw : -23.5,
      pitchDeg: m.pitch != null ? m.pitch : 5.0,
      pvMM: mm(m.pivot), czMM: mm(m.center_zero),
      eyeMM: mm(d.eye_center), ipdMM: (d.interpupillary_distance || 0.065) * 1000,
      gfMM: mm(g.front_mid), grMM: mm(g.rear_mid),
      rwMM: rwOutline.map(mm),
      rwTMM: (rw.transparent_zone || []).map(mm),
      groundZ: g.front_mid ? g.front_mid[2] : ((r.visualization && r.visualization.ground_plane_z) || 0),
    };
    const btn = $('wiz-int-save-btn');
    btn.disabled = true; btn.textContent = '保存中…';
    try {
      const resp = await fetch(API_BASE + '/vehicles/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await resp.json();
      if (!d.ok) throw new Error(d.error);

      // 保存镜面轮廓 (outline_local_mm → 车型 outline_path)
      const ol = r._meta && r._meta.outline_local_mm;
      if (ol && ol.length >= 3) {
        const safe = name.replace(/[\\/:*?"<>|]/g, '_');
        const saveResp = await fetch(API_BASE + '/vehicles/save-outline', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vehiclePath: d.path, kind: 'mirror', outlineFile: { source: 'step_interior_extract', outline_local_mm: ol, outline_count: ol.length, unit: 'mm' } }),
        });
        const sd = await saveResp.json();
        if (!sd.ok) throw new Error(sd.error);
      }

      // 跳校核页 (复用 saveNewVehicle 的 DOM 就绪 + 加载逻辑, 避免 initInner 竞态)
      if (!pages.inner.__inited) {
        pages.inner.__inited = true;
        initInnerDOM();
      }
      await loadVehicles();
      $('vehicle-select').value = d.path;
      showPage('inner');
      await loadVehicleConfig(d.path);
      await doVerify();
    } catch (e) {
      alert('保存失败: ' + e.message);
    } finally { btn.disabled = false; btn.textContent = '保存并校核'; }
  }

  function initWizardInterior() {
    $('wiz-int-back').addEventListener('click', () => showPage('mirror-type'));
    $('wiz-int-step0-next').addEventListener('click', () => wizardIntNext(0));
    $('wiz-int-step1-prev').addEventListener('click', () => wizardIntPrev(1));
    $('wiz-int-step1-next').addEventListener('click', () => wizardIntNext(1));
    $('wiz-int-step2-prev').addEventListener('click', () => wizardIntPrev(2));
    $('wiz-int-step2-next').addEventListener('click', () => wizardIntNext(2));
    $('wiz-int-step3-prev').addEventListener('click', () => wizardIntPrev(3));
    $('wiz-int-upload-btn').addEventListener('click', () => doWizIntUpload());
    $('wiz-int-step').addEventListener('change', () => doWizIntUpload());
    $('wiz-int-save-btn').addEventListener('click', doWizIntSave);
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
      extRawConfig = d.raw || null;
      const set = (id, v) => { const el = $(id); if (el) el.value = v; };
      const L = d.mirrors.left, R = d.mirrors.right;
      set('ext-sr-fit', L.sr_fit); set('ext-sr-nominal', L.sr_nominal); set('ext-sr-tol', L.sr_tolerance);
      ['x', 'y', 'z'].forEach((ax, i) => {
        set('ext-c-L-' + ax, L.sphere_center[i]); set('ext-c-R-' + ax, R.sphere_center[i]);
        set('ext-p1-L-' + ax, L.turret_axis_p1[i]); set('ext-p1-R-' + ax, R.turret_axis_p1[i]);
        set('ext-axis-L-' + ax, L.rotation_axis_dir[i]); set('ext-axis-R-' + ax, R.rotation_axis_dir[i]);
      });
      setExtAxisHint('L', L.rotation_axis_dir); setExtAxisHint('R', R.rotation_axis_dir);
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

  // 轴线补录: 默认 [0,1,0] 时提示补录真轴 (STEP 无法自动提取轴线, 已证无此几何)
  function setExtAxisHint(side, dir) {
    const el = $('ext-axis-hint-' + side);
    if (!el) return;
    const isDefault = Array.isArray(dir) && dir.length >= 3
      && Math.abs(dir[0]) < 1e-6 && Math.abs(dir[1] - 1) < 1e-6 && Math.abs(dir[2]) < 1e-6;
    el.style.color = isDefault ? '#ff9f0a' : '#9a9aa0';
    el.textContent = isDefault
      ? '使用默认轴 [0,1,0], 建议补录真轴'
      : '已补录真轴 [' + dir.map(v => v.toFixed(4)).join(', ') + ']';
  }

  // 读取某侧旋转轴方向输入, 非法 (NaN/零向量) 返回 null
  function readExtAxis(side) {
    const v = ['x', 'y', 'z'].map(ax => parseFloat($('ext-axis-' + side + '-' + ax).value));
    if (v.some(n => !Number.isFinite(n))) return null;
    if (Math.hypot(v[0], v[1], v[2]) < 1e-9) return null;
    return v;
  }

  // 从输入卡回写轴线到完整 JSON 副本 (深拷贝, 不污染 extRawConfig)
  function extPatchedConfig() {
    const axisL = readExtAxis('L'), axisR = readExtAxis('R');
    if (!axisL || !axisR) throw new Error('旋转轴方向向量非法 (需非零 3 维向量)');
    const config = JSON.parse(JSON.stringify(extRawConfig));
    if (!config.exterior_mirror_left) config.exterior_mirror_left = {};
    if (!config.exterior_mirror_right) config.exterior_mirror_right = {};
    config.exterior_mirror_left.rotation_axis_dir = axisL;
    config.exterior_mirror_right.rotation_axis_dir = axisR;
    return config;
  }

  // 保存 (覆盖当前车型) — 默认车型被后端拦截, 需另存为
  async function doExtSave() {
    if (!extRawConfig) { $('ext-status').textContent = '请先加载车型'; return; }
    const name = $('ext-vehicle-select').selectedOptions[0]?.textContent || '新外镜车型';
    try {
      const config = extPatchedConfig();
      const r = await fetch('api/exterior/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, path: extCurrentPath, config }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      await loadExtVehicles();
      await loadExtConfig(d.path);
      await doExtVerify();
      $('ext-status').textContent = '已保存: ' + String(d.path || '').split(/[\\/]/).pop();
    } catch (e) {
      $('ext-status').textContent = '保存失败: ' + e.message;
      alert('保存失败: ' + e.message);
    }
  }

  // 另存为 (不传 path → 后端按 name 生成新文件; 默认车型保护也在此生效)
  async function doExtSaveAs() {
    if (!extRawConfig) { $('ext-status').textContent = '请先加载车型'; return; }
    const name = (prompt('输入新外镜车型名称:') || '').trim();
    if (!name) return;
    try {
      const config = extPatchedConfig();
      const r = await fetch('api/exterior/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, config }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      await loadExtVehicles();
      await loadExtConfig(d.path);
      await doExtVerify();
      $('ext-status').textContent = '已另存为: ' + name;
    } catch (e) {
      $('ext-status').textContent = '另存为失败: ' + e.message;
      alert('另存为失败: ' + e.message);
    }
  }

  // 删除当前车型 — 默认车型被后端拦截
  async function doExtDelete() {
    if (!extCurrentPath) return;
    if (!confirm('确定删除该外镜车型？此操作不可撤销。')) return;
    try {
      const r = await fetch('api/exterior/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: extCurrentPath }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      await loadExtVehicles();
      await loadExtConfig($('ext-vehicle-select').value);
      await doExtVerify();
      $('ext-status').textContent = '已删除车型';
    } catch (e) {
      $('ext-status').textContent = '删除失败: ' + e.message;
      alert('删除失败: ' + e.message);
    }
  }

  async function doExtVerify() {
    const btn = $('ext-verify-btn');
    btn.disabled = true; btn.textContent = '校核中…'; $('ext-status').textContent = '';
    const psi = parseFloat($('ext-psi').value) || 0;
    try {
      const r = await fetch('api/exterior/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: extCurrentPath || '', psi }),
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
    try {
      const r0 = await fetch('api/exterior/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: extCurrentPath || '', psi: 0 }),
      });
      const d0 = await r0.json();
      if (!d0.ok) throw new Error(d0.error);
      const cs = d0.commonSearch;
      if (!cs.found) {
        renderExtVerdict(d0); renderExtPlot(d0.viz);
        $('ext-auto-status').textContent = '±3° 内无两镜都过的角度';
        return;
      }
      // 应用最佳 ψ, 回填输入框, 重新校核渲染
      $('ext-psi').value = cs.bestPsi;
      const r1 = await fetch('api/exterior/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: extCurrentPath || '', psi: cs.bestPsi }),
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
      b.textContent = (s === 'left' ? '左 ' : '右 ') + (r.mirrorPass ? 'PASS' : 'FAIL');
      b.className = 'verdict-badge ' + (r.mirrorPass ? 'badge-pass' : 'badge-fail');
    };
    side('left', d.left); side('right', d.right);
    $('ext-verdict-detail').textContent = `ψ=${d.psi != null ? d.psi : 0}° · ${d.left.mirrorPass && d.right.mirrorPass ? '两镜均通过' : (d.left.search.found || d.right.search.found ? '±3° 内有解' : '±3° 内无解')}`;

    // 简洁判定: 每镜一行, 说明近/远场是否满足 + 最小安全距离
    const zoneLine = (label, r) => {
      const near = r.nearPass
        ? `<span style="color:#34c759">近场 ✓ 满足 (最近 ${r.nearMinMargin != null ? r.nearMinMargin.toFixed(1) : '-'}mm > 3mm)</span>`
        : `<span style="color:#ff3b30">近场 ✗ 不足 (最近 ${r.nearMinMargin != null ? r.nearMinMargin.toFixed(1) : '-'}mm < 3mm)</span>`;
      const far = r.farPass
        ? `<span style="color:#34c759">远场 ✓ 满足 (最近 ${r.farMinMargin != null ? r.farMinMargin.toFixed(1) : '-'}mm > 3mm)</span>`
        : `<span style="color:#ff3b30">远场 ✗ 不足 (最近 ${r.farMinMargin != null ? r.farMinMargin.toFixed(1) : '-'}mm < 3mm)</span>`;
      const adj = r.search.found
        ? `<span style="color:#34c759">±3° ✓ (${r.search.bestPsi}°)</span>`
        : `<span style="color:#ff3b30">±3° ✗ 无解</span>`;
      return `<div style="font-size:12px;line-height:1.8"><b>${label}</b>: ${near} · ${far} · ${adj}</div>`;
    };
    $('ext-verdict-edges').innerHTML = zoneLine('左', d.left) + zoneLine('右', d.right);
    // 数据质量: 拟合球心 vs 供应商 (各字段可能为 null, 防御 toFixed/toExponential 崩溃)
    const fmtC = (v) => Array.isArray(v) ? v.map(x => Number.isFinite(x) ? x.toFixed(3) : '-').join(',') : '-';
    const fmtE = (v) => Number.isFinite(v) ? v.toExponential(0) : '-';
    const fmtD = (cc) => (cc && Number.isFinite(cc.devMm)) ? cc.devMm.toFixed(1) : '-';
    const fitLine = (label, r) => `<div class="mono" style="font-size:11px;color:#9a9aa0;line-height:1.6"><b>${label}</b> 球心[${fmtC(r.fit && r.fit.center)}] 残差${fmtE(r.fit && r.fit.residualMm)}mm 交叉✓(${fmtD(r.fit && r.fit.crossCheck)}mm)</div>`;
    $('ext-verdict-fit').innerHTML = fitLine('左', d.left) + fitLine('右', d.right);
  }

  // 轮廓内偏移 3mm 安全线 (法规: 视野线到边缘安全距离 > 3mm)
  // 用局部法线偏移 (对密集点精确), 法线指向多边形内部 (质心方向)
  function computeSafetyLine(outlineUV, offsetMm) {
    const n = outlineUV.length;
    if (n < 3) return [];
    // 质心
    let cx = 0, cy = 0;
    for (const p of outlineUV) { cx += p[0]; cy += p[1]; }
    cx /= n; cy /= n;
    const out = [];
    for (let i = 0; i < n; i++) {
      const prev = outlineUV[(i - 1 + n) % n];
      const next = outlineUV[(i + 1) % n];
      // 局部切线 = 相邻点差分
      let tx = next[0] - prev[0], ty = next[1] - prev[1];
      const tl = Math.hypot(tx, ty);
      if (tl < 1e-9) continue;
      tx /= tl; ty /= tl;
      // 法线 (切线旋转 90°), 选指向质心的一侧
      let nx = -ty, ny = tx;
      if (nx * (cx - outlineUV[i][0]) + ny * (cy - outlineUV[i][1]) < 0) { nx = -nx; ny = -ny; }
      out.push([outlineUV[i][0] + nx * offsetMm, outlineUV[i][1] + ny * offsetMm]);
    }
    return out;
  }

  // ── 2D 反射面投影 (同内镜 mirror-view 风格: u-v mm, 轮廓 + 安全线 + 4 投影点) ──
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
    // 3mm 安全线 (虚线, 画在投影线之上确保可见; 视野线越过此线 = 安全距离不足)
    const safeLine = computeSafetyLine(M.outlineUV, 3.0);
    if (safeLine.length >= 3) {
      const sl = safeLine.concat([safeLine[0]]);
      traces.push({
        x: sl.map(p => p[0]), y: sl.map(p => p[1]), mode: 'lines',
        line: { color: '#ff3b30', width: 3, dash: 'dash' },
        name: '安全线 (距边缘 3mm)', hoverinfo: 'name',
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
    $('ext-panel-left').textContent = Lm.mirrorPass ? 'PASS' : 'FAIL';
    $('ext-panel-right').textContent = Rm.mirrorPass ? 'PASS' : 'FAIL';
  }
})();

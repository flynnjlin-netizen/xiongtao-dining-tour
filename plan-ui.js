(function () {
  'use strict';
  const $ = id => document.getElementById(id), ns = 'http://www.w3.org/2000/svg';
  const plan = window.PHOTO_TOUR_PLAN, nodes = window.PHOTO_TOUR || [];
  if (!plan || !$('planMap')) { if ($('planToggle')) $('planToggle').hidden = true; return; }
  const map = $('planMap'), box = $('planPanel'), full = plan.viewBox.slice(), transform = plan.cadToSvg;
  let view = full.slice(), current, loaded = false, enlarged = false, pointer, dragged = false, allPoints = false, following = true;
  const mobile = () => window.innerWidth < 980;
  function svg(tag, attrs) { const el = document.createElementNS(ns, tag); for (const key in attrs) el.setAttribute(key, attrs[key]); return el; }
  function point(cad) { return [cad[0] * transform.scaleX + transform.offsetX, cad[1] * transform.scaleY + transform.offsetY]; }
  const layer = svg('g', {}), marker = svg('g', { 'pointer-events': 'none' });
  const cone = svg('path', { fill: '#bc302846', stroke: '#b12d28', 'stroke-width': 1 });
  const arrow = svg('path', { fill: '#b12d28', stroke: '#fff', 'stroke-width': 2 });
  const center = svg('circle', { fill: '#b12d28', stroke: '#fff', 'stroke-width': 2 });
  marker.append(cone, arrow, center);
  const dots = [];
  function load() {
    if (loaded) return; loaded = true;
    const background = svg('image', { href: plan.image || plan.background || 'plan/floorplan-base.png', x: full[0], y: full[1], width: full[2], height: full[3], preserveAspectRatio: 'none', 'pointer-events': 'none' });
    map.append(background, layer);
    for (const node of nodes) {
      if (!Array.isArray(node.cad_xy)) continue;
      const xy = point(node.cad_xy), dot = svg('circle', { cx: xy[0], cy: xy[1], fill: '#67665d', stroke: '#fff', 'stroke-width': 1, role: 'button', tabindex: 0, 'aria-label': '在图纸中前往' + node.name });
      const title = svg('title', {}); title.textContent = node.id + ' · ' + node.name; dot.appendChild(title);
      const go = () => document.dispatchEvent(new CustomEvent('tour:go', { detail: { id: node.id } }));
      dot.addEventListener('click', e => { if (!dragged) { e.stopPropagation(); go(); } });
      dot.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      layer.appendChild(dot); dots.push({ el: dot, id: node.id });
    }
    map.appendChild(marker);
  }
  function draw() {
    map.setAttribute('viewBox', view.join(' '));
    const rect = map.getBoundingClientRect(), unit = Math.max(view[2] / Math.max(rect.width, 1), view[3] / Math.max(rect.height, 1));
    const adjacent = nodes.find(n => n.id === current?.id)?.neighbors || [];
    for (const dot of dots) { dot.el.setAttribute('r', unit * 4.5); dot.el.setAttribute('stroke-width', unit); dot.el.style.display = dot.id === current?.id || (!allPoints && !adjacent.includes(dot.id)) ? 'none' : ''; }
    if (!current?.cad_xy) { marker.style.display = 'none'; return; }
    marker.style.display = '';
    const xy = point(current.cad_xy), rotation = -current.yaw * 180 / Math.PI;
    marker.setAttribute('transform', 'translate(' + xy.join(' ') + ') rotate(' + rotation + ')');
    const canvasRect = $('panorama').getBoundingClientRect(), aspect = canvasRect.width / Math.max(canvasRect.height, 1);
    const half = Math.min(58, Math.atan(Math.tan(current.fov * Math.PI / 360) * aspect) * 180 / Math.PI) * Math.PI / 180;
    const radius = unit * 38, dx = radius * Math.sin(half), dy = -radius * Math.cos(half);
    cone.setAttribute('d', 'M0 0 L' + (-dx) + ' ' + dy + ' A' + radius + ' ' + radius + ' 0 0 1 ' + dx + ' ' + dy + ' Z');
    cone.setAttribute('stroke-width', unit);
    arrow.setAttribute('d', 'M0 ' + (-unit * 15) + ' L' + (unit * 7) + ' ' + (unit * 3) + ' L0 ' + (-unit * 1) + ' L' + (-unit * 7) + ' ' + (unit * 3) + ' Z');
    arrow.setAttribute('stroke-width', unit * 1.5); center.setAttribute('r', unit * 5); center.setAttribute('stroke-width', unit * 1.4);
  }
  function limit() {
    view[2] = Math.max(full[2] / 8, Math.min(full[2], view[2]));
    view[3] = Math.max(full[3] / 8, Math.min(full[3], view[3]));
    view[0] = Math.max(full[0], Math.min(full[0] + full[2] - view[2], view[0]));
    view[1] = Math.max(full[1], Math.min(full[1] + full[3] - view[3], view[1])); draw();
  }
  function followLabel() { $('planLocate').setAttribute('aria-pressed', String(following)); $('planMode').textContent = following ? '局部跟随 · 换位置自动定位' : '自由查看 · 可拖动、缩放'; }
  function locate() {
    if (!current?.cad_xy) return;
    following = true;
    const xy = point(current.cad_xy), rect = map.getBoundingClientRect(), aspect = Math.max(.55, rect.width / Math.max(rect.height, 1));
    view[2] = full[2] / (mobile() ? 3.8 : 4.2); view[3] = Math.min(full[3] / 1.2, view[2] / aspect);
    view[0] = xy[0] - view[2] / 2; view[1] = xy[1] - view[3] / 2; followLabel(); limit();
  }
  function zoom(factor) { const cx = view[0] + view[2] / 2, cy = view[1] + view[3] / 2; view[2] *= factor; view[3] *= factor; view[0] = cx - view[2] / 2; view[1] = cy - view[3] / 2; limit(); }
  function layout() {
    document.body.classList.add('fixed-plan');
    document.body.classList.toggle('plan-open', !mobile() || enlarged);
    box.classList.toggle('enlarged', enlarged);
    box.hidden = false;
    $('planToggle').setAttribute('aria-expanded', String(!mobile() || enlarged));
    $('planToggle').textContent = enlarged ? '返回全景' : (mobile() ? '展开图纸' : '全屏图纸');
    $('planExpand').textContent = enlarged ? '返回全景' : '全屏图纸';
    $('planExpand').setAttribute('aria-pressed', String(enlarged));
    $('planClose').hidden = !enlarged;
    $('planMobileToggle').setAttribute('aria-expanded', String(enlarged));
    $('planMobileToggle').textContent = enlarged ? '收起图纸 ▾' : '展开图纸 ▴';
    load(); requestAnimationFrame(() => { if (following) locate(); else draw(); });
  }
  function expand(value) { enlarged = value; layout(); }
  $('planToggle').addEventListener('click', () => expand(!enlarged));
  $('planMobileToggle').addEventListener('click', () => expand(!enlarged));
  $('planClose').addEventListener('click', () => expand(false));
  $('planAll').addEventListener('click', () => { allPoints = !allPoints; $('planAll').setAttribute('aria-pressed', String(allPoints)); $('planAll').textContent = allPoints ? '收起点位' : '全部点位'; draw(); });
  $('planExpand').addEventListener('click', () => expand(!enlarged));
  $('planPlus').addEventListener('click', () => zoom(.75)); $('planMinus').addEventListener('click', () => zoom(1 / .75));
  $('planReset').addEventListener('click', () => { following = false; view = full.slice(); followLabel(); draw(); });
  $('planLocate').addEventListener('click', locate);
  map.addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15); }, { passive: false });
  map.addEventListener('pointerdown', e => { if (e.button > 0) return; pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, view: view.slice() }; dragged = false; if (!e.target.closest('circle[role=button]')) map.setPointerCapture(e.pointerId); });
  map.addEventListener('pointermove', e => { if (!pointer || pointer.id !== e.pointerId) return; const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y; if (Math.hypot(dx, dy) > 5) dragged = true; if (!dragged) return; following = false; followLabel(); const rect = map.getBoundingClientRect(), scale = Math.max(pointer.view[2] / rect.width, pointer.view[3] / rect.height); view[0] = pointer.view[0] - dx * scale; view[1] = pointer.view[1] - dy * scale; limit(); });
  ['pointerup', 'pointercancel'].forEach(name => map.addEventListener(name, () => { pointer = null; }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && enlarged) expand(false); });
  document.addEventListener('tour:view', e => {
    const changed = current?.id !== e.detail.id; current = e.detail;
    const node = nodes.find(n => n.id === current.id);
    $('planCurrent').textContent = current.nodeName;
    $('planPointId').textContent = current.id + ' · ' + (node?.group || '二层餐厅');
    $('planMobileName').textContent = current.nodeName;
    $('planToggle').title = '图纸定位：' + current.nodeName;
    if (changed && following) locate(); else if (!mobile() || enlarged) draw();
  });
  window.addEventListener('resize', layout);
  followLabel(); layout();
})();

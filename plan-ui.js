(function () {
  'use strict';
  const $ = id => document.getElementById(id), ns = 'http://www.w3.org/2000/svg';
  const plan = window.PHOTO_TOUR_PLAN, nodes = window.PHOTO_TOUR || [];
  if (!plan || !$('planMap')) { if ($('planToggle')) $('planToggle').hidden = true; return; }
  const map = $('planMap'), box = $('planPanel'), full = plan.viewBox.slice(), transform = plan.cadToSvg;
  let view = full.slice(), current, loaded = false, enlarged = false, pointer, dragged = false, allPoints = false;
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
      dot.addEventListener('click', e => { if (!dragged) { e.stopPropagation(); document.dispatchEvent(new CustomEvent('tour:go', { detail: { id: node.id } })); } });
      dot.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.dispatchEvent(new CustomEvent('tour:go', { detail: { id: node.id } })); } });
      layer.appendChild(dot); dots.push({ el: dot, id: node.id });
    }
    map.appendChild(marker); draw();
  }
  function draw() {
    map.setAttribute('viewBox', view.join(' '));
    const rect = map.getBoundingClientRect(), unit = Math.max(view[2] / Math.max(rect.width, 1), view[3] / Math.max(rect.height, 1));
    const adjacent = nodes.find(n => n.id === current?.id)?.neighbors || [];
    for (const dot of dots) { dot.el.setAttribute('r', unit * 3.3); dot.el.setAttribute('stroke-width', unit * .8); dot.el.style.display = dot.id === current?.id || (!allPoints && !adjacent.includes(dot.id)) ? 'none' : ''; }
    if (!current?.cad_xy) { marker.style.display = 'none'; return; }
    marker.style.display = '';
    const xy = point(current.cad_xy), rotation = -current.yaw * 180 / Math.PI;
    marker.setAttribute('transform', 'translate(' + xy.join(' ') + ') rotate(' + rotation + ')');
    const canvasRect = $('panorama').getBoundingClientRect(), aspect = canvasRect.width / Math.max(canvasRect.height, 1);
    const half = Math.min(58, Math.atan(Math.tan(current.fov * Math.PI / 360) * aspect) * 180 / Math.PI) * Math.PI / 180;
    const radius = unit * 34, dx = radius * Math.sin(half), dy = -radius * Math.cos(half);
    cone.setAttribute('d', 'M0 0 L' + (-dx) + ' ' + dy + ' A' + radius + ' ' + radius + ' 0 0 1 ' + dx + ' ' + dy + ' Z');
    cone.setAttribute('stroke-width', unit);
    arrow.setAttribute('d', 'M0 ' + (-unit * 12) + ' L' + (unit * 6) + ' ' + (unit * 2) + ' L0 ' + (-unit * 1) + ' L' + (-unit * 6) + ' ' + (unit * 2) + ' Z');
    arrow.setAttribute('stroke-width', unit * 1.4); center.setAttribute('r', unit * 4); center.setAttribute('stroke-width', unit * 1.3);
  }
  function limit() {
    view[2] = Math.max(full[2] / 6, Math.min(full[2], view[2])); view[3] = view[2] * full[3] / full[2];
    view[0] = Math.max(full[0], Math.min(full[0] + full[2] - view[2], view[0]));
    view[1] = Math.max(full[1], Math.min(full[1] + full[3] - view[3], view[1])); draw();
  }
  function zoom(factor) { const cx = view[0] + view[2] / 2, cy = view[1] + view[3] / 2; view[2] *= factor; view[3] *= factor; view[0] = cx - view[2] / 2; view[1] = cy - view[3] / 2; limit(); }
  function show(open) { box.hidden = !open; $('planToggle').setAttribute('aria-expanded', String(open)); if (open) { load(); draw(); } else if (enlarged) expand(false); }
  function expand(value) { enlarged = value; box.classList.toggle('enlarged', value); $('planExpand').textContent = value ? '缩回小窗' : '放大图纸'; $('planExpand').setAttribute('aria-pressed', String(value)); if (value && window.innerWidth <= 650 && view[2] === full[2] && current?.cad_xy) { const xy = point(current.cad_xy); view[2] = full[2] / 3; view[3] = full[3] / 3; view[0] = xy[0] - view[2] / 2; view[1] = xy[1] - view[3] / 2; limit(); } requestAnimationFrame(draw); }
  $('planToggle').addEventListener('click', () => show(box.hidden)); $('planClose').addEventListener('click', () => show(false));
  $('planAll').addEventListener('click', () => { allPoints = !allPoints; $('planAll').setAttribute('aria-pressed', String(allPoints)); $('planAll').textContent = allPoints ? '收起点位' : '全部点位'; draw(); });
  $('planExpand').addEventListener('click', () => expand(!enlarged)); $('planPlus').addEventListener('click', () => zoom(.7)); $('planMinus').addEventListener('click', () => zoom(1 / .7));
  $('planReset').addEventListener('click', () => { view = full.slice(); draw(); });
  $('planLocate').addEventListener('click', () => { if (!current?.cad_xy) return; const xy = point(current.cad_xy); view[0] = xy[0] - view[2] / 2; view[1] = xy[1] - view[3] / 2; limit(); });
  map.addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15); }, { passive: false });
  map.addEventListener('pointerdown', e => { if (e.button > 0) return; pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, view: view.slice() }; dragged = false; if (!e.target.closest('circle[role=button]')) map.setPointerCapture(e.pointerId); });
  map.addEventListener('pointermove', e => { if (!pointer || pointer.id !== e.pointerId) return; const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y; if (Math.hypot(dx, dy) > 5) dragged = true; if (!dragged) return; const rect = map.getBoundingClientRect(), scale = Math.max(pointer.view[2] / rect.width, pointer.view[3] / rect.height); view[0] = pointer.view[0] - dx * scale; view[1] = pointer.view[1] - dy * scale; limit(); });
  ['pointerup', 'pointercancel'].forEach(name => map.addEventListener(name, () => { pointer = null; }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !box.hidden) { if (enlarged) expand(false); else show(false); } });
  document.addEventListener('tour:view', e => { const changed = current?.id !== e.detail.id; current = e.detail; $('planCurrent').textContent = current.id + ' · ' + current.nodeName; $('planToggle').title = '图纸定位：' + current.nodeName; if (changed && view[2] < full[2] && current.cad_xy) { const xy = point(current.cad_xy); view[0] = xy[0] - view[2] / 2; view[1] = xy[1] - view[3] / 2; limit(); } if (!box.hidden) draw(); });
  window.addEventListener('resize', () => { if (!box.hidden) draw(); });
})();

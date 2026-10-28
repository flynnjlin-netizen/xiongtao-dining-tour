(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('panorama'), fallback = $('fallbackImage');
  const nodes = (Array.isArray(window.PHOTO_TOUR) ? window.PHOTO_TOUR : []).filter(n => n && n.id && n.name && n.image);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const savingData = !!(navigator.connection && (navigator.connection.saveData || /2g/.test(navigator.connection.effectiveType || '')));
  const state = { current: null, requested: null, currentKey: null, requestedKey: null, quality: savingData ? 'smooth' : 'hd', currentQuality: null, yaw: 0, pitch: 0, fov: 74, token: 0, width: 1, height: 1, raf: 0 };
  const textures = new Map(), inflight = new Map(), pointers = new Map();
  let gl, program, uniforms, prefetchTimer, dragPoint, pinchDistance = 0, lastTexture = null;
  let lost = false, retryTarget = null, statusVersion = 0;
  const maxTextures = 3;

  function status(message, retry) {
    $('statusText').textContent = message;
    $('status').hidden = !message;
    $('retry').hidden = !retry;
    return ++statusVersion;
  }
  function radians(degrees) { return degrees * Math.PI / 180; }
  function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
  function photoSource(node, quality) { return quality === 'hd' ? node.hdImage || node.original || node.image : node.image; }
  function photoKey(node, quality) { return node.id + '|' + quality; }
  function updateQualityControl() {
    const control = $('quality'); if (!control) return;
    control.textContent = state.quality === 'hd' ? '画质：高清' : '画质：流畅';
    control.setAttribute('aria-pressed', String(state.quality === 'hd'));
    control.title = state.quality === 'hd' ? '点击切换流畅画质' : '点击加载高清画质';
  }
  function emitView() {
    if (!state.current || typeof CustomEvent === 'undefined' || !document.dispatchEvent) return;
    document.dispatchEvent(new CustomEvent('tour:view', { detail: { id: state.current.id, nodeName: state.current.name, cad_xy: state.current.cad_xy, yaw: state.yaw, pitch: state.pitch, fov: state.fov, quality: state.currentQuality } }));
  }
  function initialYaw(node) {
    if (!Array.isArray(node.cad_xy) || !Array.isArray(node.lookAt)) return 0;
    return Math.atan2(-(node.lookAt[0] - node.cad_xy[0]), node.lookAt[1] - node.cad_xy[1]);
  }
  function shader(type, source) {
    const item = gl.createShader(type);
    gl.shaderSource(item, source); gl.compileShader(item);
    if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) throw new Error('显示程序暂时不可用');
    return item;
  }
  function initializeGL() {
    try {
      gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
      if (!gl) return false;
      const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT).precision ? 'highp' : 'mediump';
      const vertex = shader(gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 uv; void main(){uv=p;gl_Position=vec4(p,0.,1.);}');
      const fragment = shader(gl.FRAGMENT_SHADER, 'precision ' + precision + ' float; varying vec2 uv; uniform sampler2D photo; uniform float aspect; uniform float scale; uniform vec2 angles; const float PI=3.141592653589793; void main(){vec3 r=normalize(vec3(uv.x*aspect*scale,uv.y*scale,-1.));float cp=cos(angles.y),sp=sin(angles.y);r=vec3(r.x,cp*r.y-sp*r.z,sp*r.y+cp*r.z);float cy=cos(angles.x),sy=sin(angles.x);r=vec3(cy*r.x+sy*r.z,r.y,-sy*r.x+cy*r.z);vec2 st=vec2(fract(.5+atan(r.x,-r.z)/(2.*PI)),.5+asin(clamp(r.y,-1.,1.))/PI);gl_FragColor=vec4(texture2D(photo,st).rgb,1.);}');
      program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
      gl.useProgram(program);
      const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      uniforms = Object.fromEntries(['photo', 'aspect', 'scale', 'angles'].map(name => [name, gl.getUniformLocation(program, name)]));
      gl.uniform1i(uniforms.photo, 0); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      return true;
    } catch (error) { gl = null; return false; }
  }
  function resize() {
    const rect = canvas.getBoundingClientRect();
    state.width = Math.max(1, rect.width); state.height = Math.max(1, rect.height);
    const ratio = Math.min(window.devicePixelRatio || 1, 2, 4096 / Math.max(state.width, state.height), Math.sqrt(8 * 1024 * 1024 / (state.width * state.height)));
    const width = Math.max(1, Math.floor(state.width * ratio)), height = Math.max(1, Math.floor(state.height * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    invalidate();
  }
  function invalidate() {
    if (!state.raf) state.raf = requestAnimationFrame(render);
  }
  function render() {
    state.raf = 0;
    if (gl && !lost && lastTexture) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, lastTexture);
      gl.uniform1f(uniforms.aspect, state.width / state.height);
      gl.uniform1f(uniforms.scale, Math.tan(radians(state.fov) / 2));
      gl.uniform2f(uniforms.angles, state.yaw, state.pitch);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    placeHotspots();
    emitView();
  }
  function trimTextures(reserve) {
    if (!gl) return;
    while (textures.size + (reserve || 0) > maxTextures) {
      const victim = [...textures.keys()].find(key => key !== state.currentKey && key !== state.requestedKey);
      if (!victim) break;
      gl.deleteTexture(textures.get(victim).texture); textures.delete(victim);
    }
  }
  function touchTexture(id) {
    const entry = textures.get(id);
    if (entry) { textures.delete(id); textures.set(id, entry); }
    return entry;
  }
  function cancelObsoleteLoads(wanted) {
    for (const [id, task] of inflight) if (id !== wanted) { task.cancel(); inflight.delete(id); }
  }
  function requestPhoto(node, quality, transform) {
    const key = photoKey(node, quality);
    if (inflight.has(key)) return inflight.get(key).promise;
    let url;
    try { url = new URL(photoSource(node, quality), location.href); }
    catch (error) { return Promise.reject(new Error('这张全景的地址暂时不可用')); }
    let image = new Image(), settle, rejectLoad;
    const promise = new Promise((resolve, reject) => { settle = resolve; rejectLoad = reject; });
    const cleanup = () => { image.onload = image.onerror = null; inflight.delete(key); };
    inflight.set(key, { promise, cancel: () => { cleanup(); image.removeAttribute('src'); rejectLoad(new Error('cancelled')); } });
    image.decoding = 'async';
    image.onload = () => {
      try {
        const result = transform ? transform(image) : image;
        cleanup(); settle(result);
      } catch (error) { cleanup(); rejectLoad(error); }
    };
    image.onerror = () => { cleanup(); rejectLoad(new Error('这张全景暂未加载成功')); };
    // Same-origin assets work without a CORS round trip; external assets must permit anonymous reading.
    if (url.origin !== location.origin) image.crossOrigin = 'anonymous';
    image.src = url.href;
    return promise;
  }
  function getTexture(node, quality) {
    const key = photoKey(node, quality), cached = touchTexture(key);
    if (cached) return Promise.resolve(cached);
    return requestPhoto(node, quality, image => {
      let texture;
      try {
        if (lost || !gl) throw new Error('显示已中断，请重试');
        // Evict before allocation so even a large image upload never holds a fourth texture.
        trimTextures(1);
        texture = gl.createTexture();
        if (!texture) throw new Error('设备暂时无法显示这张全景');
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        let source = image;
        const limit = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 8192);
        if (image.width > limit || image.height > limit) {
          source = document.createElement('canvas'); const factor = limit / Math.max(image.width, image.height);
          source.width = Math.round(image.width * factor); source.height = Math.round(image.height * factor);
          source.getContext('2d').drawImage(image, 0, 0, source.width, source.height);
        }
        gl.getError();
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
        if (gl.getError() !== gl.NO_ERROR) throw new Error('这张全景暂时无法显示，请重试');
        const entry = { texture, width: image.width, height: image.height };
        textures.set(key, entry); trimTextures(); return entry;
      } catch (error) { if (texture) gl.deleteTexture(texture); throw error; }
    });
  }
  function prefetchNeighbor(node) {
    clearTimeout(prefetchTimer);
    if (!gl || lost || nodes.length < 2 || (navigator.connection && (navigator.connection.saveData || /2g/.test(navigator.connection.effectiveType || '')))) return;
    prefetchTimer = setTimeout(() => {
      if (state.current !== node || state.requested !== node || document.hidden) return;
      // Neighbour prefetch always uses the small image, including while this view is HD.
      const adjacent = (node.neighbors || []).map(id => byId.get(id)).find(n => n && !textures.has(photoKey(n, 'smooth')));
      if (adjacent) getTexture(adjacent, 'smooth').catch(() => {});
    }, 1500);
  }
  function updateControls(node) {
    const index = nodes.indexOf(node);
    $('positionName').textContent = node.name;
    $('positions').value = node.id;
    $('positions').title = node.name;
    $('positionCount').textContent = (index + 1) + ' / ' + nodes.length;
    $('previous').disabled = index <= 0; $('next').disabled = index >= nodes.length - 1;
    const original = node.hdImage || node.original || node.image;
    const download = $('download'); download.href = original;
    download.download = '雄韬_' + node.name + '.' + (String(original).split('.').pop().split('?')[0] || 'jpg');
    download.removeAttribute('aria-disabled');
    try { const url = new URL(location.href); url.searchParams.set('node', node.id); history.replaceState(null, '', url); } catch (error) {}
    buildHotspots();
  }
  async function setNode(id, options) {
    const node = byId.get(id); if (!node) return false;
    const quality = options?.quality || state.quality, key = photoKey(node, quality), preserveView = state.current?.id === id;
    const token = ++state.token; state.requested = node; state.requestedKey = key; state.quality = quality;
    updateQualityControl();
    retryTarget = null;
    clearTimeout(prefetchTimer); cancelObsoleteLoads(key);
    status((quality === 'hd' ? '正在加载高清 · ' : '正在加载 · ') + node.name, false);
    try {
      if (!gl) {
        const image = await requestPhoto(node, quality);
        if (token !== state.token) return false;
        // Preload separately; changing a visible img to a failed URL would erase the last good photo.
        fallback.src = image.src; fallback.hidden = false; canvas.hidden = true;
        state.current = node; state.currentKey = key; state.currentQuality = quality;
        if (!preserveView) { state.yaw = initialYaw(node); state.pitch = 0; state.fov = 74; }
        updateControls(node); status('', false); emitView();
        $('help').textContent = '当前设备显示原图 · 可下载查看';
        return true;
      }
      const entry = await getTexture(node, quality);
      if (token !== state.token) return false;
      state.current = node; state.currentKey = key; state.currentQuality = quality; lastTexture = entry.texture;
      if (!preserveView) { state.yaw = initialYaw(node); state.pitch = 0; state.fov = 74; }
      updateControls(node); status('', false); invalidate(); prefetchNeighbor(node); return true;
    } catch (error) {
      if (token === state.token && error.message !== 'cancelled') {
        retryTarget = { id: node.id, quality }; state.requested = state.current || node; state.requestedKey = state.currentKey || key;
        if (state.current) $('positions').value = state.current.id;
        status(error.message + (state.current ? '，已保留当前画面。' : '。'), true);
      }
      return false;
    }
  }
  function step(direction) {
    const index = nodes.indexOf(state.requested || state.current), node = nodes[index + direction];
    if (node) setNode(node.id);
  }
  function buildHotspots() {
    $('hotspots').replaceChildren();
    if (!gl || nodes.length < 2 || !state.current || !Array.isArray(state.current.cad_xy)) return;
    for (const id of state.current.neighbors || []) {
      const node = byId.get(id); if (!node || !Array.isArray(node.cad_xy)) continue;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'hotspot'; button.dataset.target = id;
      const title = state.current.hotspotLabels?.[id] || node.name;
      button.setAttribute('aria-label', /^(前往|转入|沿|进入|换到|返回)/.test(title) ? title : '前往' + title);
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V4m-6 6 6-6 6 6"/></svg>';
      const label = document.createElement('span'); label.textContent = title; button.appendChild(label);
      button.addEventListener('click', () => setNode(id)); $('hotspots').appendChild(button);
    }
  }
  function placeHotspots() {
    if (!state.current || !Array.isArray(state.current.cad_xy)) return;
    const tan = Math.tan(radians(state.fov) / 2), aspect = state.width / state.height;
    for (const button of $('hotspots').children) {
      const node = byId.get(button.dataset.target), anchor = state.current.hotspotAnchors?.[node.id] || node.cad_xy;
      const dx = (anchor[0] - state.current.cad_xy[0]) / 1000, dz = -(anchor[1] - state.current.cad_xy[1]) / 1000;
      const cy = Math.cos(state.yaw), sy = Math.sin(state.yaw), cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
      const x = cy * dx - sy * dz, z0 = sy * dx + cy * dz;
      // Lift very close doorway markers just enough to keep them in view.
      const drop = Math.min(1.6, Math.max(.24, Math.hypot(dx, dz) * .34));
      const y = cp * -drop + sp * z0, z = -sp * -drop + cp * z0;
      const nx = x / (-z * tan * aspect), ny = y / (-z * tan);
      const visible = z < -.05 && Math.abs(nx) < .89 && ny > -.8 && ny < .78;
      button.hidden = !visible;
      if (visible) { button.style.left = ((nx + 1) * state.width / 2) + 'px'; button.style.top = ((1 - ny) * state.height / 2) + 'px'; }
    }
  }
  function distance() { const p = [...pointers.values()]; return p.length > 1 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0; }
  canvas.addEventListener('pointerdown', event => {
    if (!gl || event.button > 0) return;
    event.preventDefault(); canvas.focus({ preventScroll: true }); canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); dragPoint = { x: event.clientX, y: event.clientY };
    pinchDistance = distance(); canvas.classList.add('dragging'); clearTimeout(prefetchTimer);
  });
  canvas.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size > 1) { const d = distance(); if (pinchDistance > 0 && d > 0) state.fov = clamp(state.fov * pinchDistance / d, 42, 100); pinchDistance = d; }
    else if (dragPoint) {
      const dx = event.clientX - dragPoint.x, dy = event.clientY - dragPoint.y;
      state.yaw += dx * .0035; state.pitch = clamp(state.pitch + dy * .0035, -1.25, 1.25);
    }
    dragPoint = { x: event.clientX, y: event.clientY }; invalidate();
  });
  function pointerEnd(event) {
    pointers.delete(event.pointerId); pinchDistance = distance();
    dragPoint = pointers.size === 1 ? [...pointers.values()][0] : null;
    if (!pointers.size) { canvas.classList.remove('dragging'); if (state.current) prefetchNeighbor(state.current); }
  }
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(event => canvas.addEventListener(event, pointerEnd));
  canvas.addEventListener('wheel', event => { if (!gl) return; event.preventDefault(); state.fov = clamp(state.fov + event.deltaY * .035, 42, 100); invalidate(); }, { passive: false });
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('keydown', event => {
    if (!gl) return;
    const key = event.key.toLowerCase();
    if (!['arrowleft', 'arrowright', 'arrowup', 'arrowdown', '+', '-', 'w', 's'].includes(key)) return;
    event.preventDefault();
    if (key === 'arrowleft') state.yaw += .08;
    if (key === 'arrowright') state.yaw -= .08;
    if (key === 'arrowup') state.pitch = clamp(state.pitch + .06, -1.25, 1.25);
    if (key === 'arrowdown') state.pitch = clamp(state.pitch - .06, -1.25, 1.25);
    if (key === '+') state.fov = clamp(state.fov - 4, 42, 100);
    if (key === '-') state.fov = clamp(state.fov + 4, 42, 100);
    if (key === 'w') step(1); if (key === 's') step(-1); invalidate();
  });
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lost = true; clearTimeout(prefetchTimer); status('显示暂时中断，请点击重试。', true); });
  $('retry').addEventListener('click', () => { if (lost) location.reload(); else if (retryTarget) setNode(retryTarget.id, { quality: retryTarget.quality }); else if (state.requested) setNode(state.requested.id); });
  $('quality')?.addEventListener('click', () => { const node = state.requested || state.current; if (node) setNode(node.id, { quality: state.quality === 'hd' ? 'smooth' : 'hd' }); });
  document.addEventListener('tour:go', event => { if (byId.has(event.detail?.id)) setNode(event.detail.id); });
  $('previous').addEventListener('click', () => step(-1)); $('next').addEventListener('click', () => step(1));
  $('positions').addEventListener('change', event => setNode(event.target.value));
  $('fullscreen').addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); else throw new Error(); }
    catch (error) {
      const notice = status('当前浏览器暂不支持全屏，可横屏查看。', false);
      setTimeout(() => { if (statusVersion === notice) status('', false); }, 2800);
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(prefetchTimer); else { resize(); if (state.current) prefetchNeighbor(state.current); } });
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe($('tour'));
  if (!nodes.length) { status('全景图片正在准备，请稍后刷新。', false); return; }
  const groups = new Map();
  for (const node of nodes) {
    const groupName = String(node.group || '其他位置');
    if (!groups.has(groupName)) {
      const group = document.createElement('optgroup'); group.label = groupName; group.title = groupName;
      groups.set(groupName, group); $('positions').appendChild(group);
    }
    const option = document.createElement('option'); option.value = node.id; option.textContent = node.name; option.title = node.name; groups.get(groupName).appendChild(option);
  }
  const single = nodes.length === 1;
  document.body.classList.toggle('single', single); $('positionBar').hidden = single;
  $('tourTitle').textContent = single ? '风格确认样板' : '雄韬 · 湘菜食堂';
  if (!initializeGL()) gl = null;
  updateQualityControl();
  resize();
  const query = new URLSearchParams(location.search).get('node'); setNode(byId.has(query) ? query : nodes[0].id);
})();

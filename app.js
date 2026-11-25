(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const video = $('video');
  const shell = $('videoShell');
  const KEY = 'live_player_channels_v1';
  const PROXY_KEY = 'live_player_proxy_v1';

  // 公开测试流（仅用于演示播放器功能，不含任何电视直播版权内容）
  // 注意：这些都是国外服务器，国内网络可能连不上，属正常现象。
  // 请添加自己的直播源使用；连不上时可用「更多 → 网络诊断」确认。
  const DEFAULT_CHANNELS = [
    { id: 'demo-bbb', name: '测试 1 · Big Buck Bunny', group: '测试源', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' },
    { id: 'demo-tos', name: '测试 2 · Tears of Steel', group: '测试源', url: 'https://test-streams.mux.dev/tos_ismc/main.m3u8' },
    { id: 'demo-uni', name: '测试 3 · Unified Streaming', group: '测试源', url: 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8' }
  ];

  let channels = [];
  let currentId = null;
  let activeGroup = '全部';
  let query = '';
  let hls = null;
  let retries = 0;
  let loadTimer = null;
  let controlsTimer = null;
  let toastTimer = null;
  let proxyPrefix = '';
  let batchMode = false;
  const selected = new Set();

  /* ---------------- 工具 ---------------- */
  const uid = () => 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isHls = (url) => /\.m3u8(\?|$)/i.test(url) || /m3u8/i.test(url);

  function loadProxy() {
    try { proxyPrefix = localStorage.getItem(PROXY_KEY) || ''; } catch (e) { proxyPrefix = ''; }
  }
  function saveProxy(value) {
    proxyPrefix = value.trim();
    try {
      if (proxyPrefix) localStorage.setItem(PROXY_KEY, proxyPrefix);
      else localStorage.removeItem(PROXY_KEY);
    } catch (e) { /* 忽略存储异常 */ }
  }
  // 配置了代理后，所有 http 源都自动走代理。
  // 原因：https 页面会拦截 http 混合内容；file:// 和 http 页面虽不拦截，但源站没有 CORS 头，
  // hls.js 的 XHR 同样取不到数据。所以只看源协议，不看页面协议。
  // 注意：添加表单里的勾选框只有「强制代理」一种显式状态，未勾选表示自动判断，
  // 不能写成 proxy:false，否则旧频道即使配了代理也不会走代理（曾经的真实 bug）。
  function needProxy(ch) {
    if (!proxyPrefix || !ch) return false;
    if (ch.proxy === true) return true;
    return /^http:/i.test(ch.url);
  }
  function requestUrl(ch) {
    return needProxy(ch) ? proxyPrefix + encodeURIComponent(ch.url) : ch.url;
  }

  // 是否 iOS 设备。注意：iPhone「添加到主屏幕」后的 PWA 独立模式，
  // User-Agent 里的 "Safari" 和 "Version" 字样会被去掉，不能只靠 /Safari/ 判断。
  function isIOSDevice() {
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/i.test(ua)) return true;
    // iPadOS 13+ 伪装成 Mac，但触摸屏有多点触控
    if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return true;
    return false;
  }

  // 是否应优先用原生 HLS：iOS 全系 + 桌面 Safari。
  // iOS 的 MediaSource 不支持 HEVC 视频（只能解音频），H265 源走 hls.js 会「有声音没图像」，
  // 必须走原生 HLS 让系统硬解。其它浏览器（Chrome/Edge）优先 hls.js。
  function preferNativeHls() {
    if (isIOSDevice()) return true;
    const ua = navigator.userAgent || '';
    return /Safari/i.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/i.test(ua);
  }

  // 浏览器 HEVC 解码能力检测（H265 在 Chrome/Edge 上普遍不支持，Safari 较新版本支持）
  function hevcSupport() {
    const v = document.createElement('video');
    const types = ['video/mp4; codecs="hvc1.1.6.L93.B0"', 'video/mp4; codecs="hev1.1.6.L93.B0"', 'video/mp4; codecs="hvc1"'];
    return types.some((t) => {
      try { return v.canPlayType(t) !== ''; } catch (e) { return false; }
    });
  }

  // 从 TS 分片头部判断编码：0x1b=H264, 0x24=H265
  function detectCodecFromTS(buf) {
    const d = new Uint8Array(buf);
    const len = Math.min(d.length, 262144);
    let h264 = 0, h265 = 0;
    for (let i = 0; i + 5 < len; i++) {
      if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 1) {
        const b = d[i + 3];
        // H264 SPS=7 / PPS=8，NAL header 是单字节
        if ((b & 0x1f) === 7 || (b & 0x1f) === 8) h264++;
        // H265 VPS(type32)=0x40 / SPS(type33)=0x42，NAL header 是双字节，第二字节通常为 0x01
        if ((b === 0x40 || b === 0x42 || b === 0x44) && d[i + 4] === 0x01) h265++;
      }
    }
    return h265 > 0 ? 'H265' : (h264 > 0 ? 'H264' : 'unknown');
  }
  function clearSearch() {
    query = '';
    $('searchInput').value = '';
    $('btnClearSearch2').hidden = true;
    render();
  }

  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(channels.filter((c) => c.custom)));
    } catch (e) { /* 隐私模式下可能不可写，忽略 */ }
  }

  function load() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { saved = []; }
    if (!Array.isArray(saved)) saved = [];
    saved = saved.filter((c) => c && c.url && c.name).map((c) => ({
      id: c.id || uid(), name: c.name, url: c.url, group: c.group || '自定义',
      custom: true, proxy: c.proxy === true ? true : null,
      codec: c.codec === 'H264' || c.codec === 'H265' ? c.codec : null
    }));
    channels = DEFAULT_CHANNELS.concat(saved);
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    const groups = ['全部'];
    channels.forEach((c) => { if (c.group && !groups.includes(c.group)) groups.push(c.group); });
    if (!groups.includes(activeGroup)) activeGroup = '全部';

    $('tabs').innerHTML = groups.map((g) =>
      `<button class="tab${g === activeGroup ? ' active' : ''}" data-group="${esc(g)}" title="${g === '全部' ? '全部频道' : '长按或右键可删除分组「' + esc(g) + '」'}">${esc(g)}</button>`
    ).join('');

    const q = query.trim().toLowerCase();
    const list = channels.filter((c) =>
      (activeGroup === '全部' || c.group === activeGroup) &&
      (!q || c.name.toLowerCase().includes(q) || c.url.toLowerCase().includes(q))
    );

    $('channelCount').textContent = channels.length + ' 个频道';
    const tags = (c) => c.codec === 'H265'
      ? ' <span class="codec-tag h265">H265</span>'
      : c.codec === 'H264' ? ' <span class="codec-tag h264">H264</span>' : '';

    if (batchMode) {
      $('channelList').innerHTML = list.map((c) => {
        const checked = selected.has(c.id);
        return `<button class="channel-card batch${checked ? ' selected' : ''}${c.custom ? '' : ' locked'}" data-id="${esc(c.id)}" data-batch="${c.custom ? esc(c.id) : ''}" title="${esc(c.url)}">
          <span class="batch-check">${c.custom ? (checked ? '✓' : '') : '·'}</span>
          <span class="card-body"><strong>${esc(c.name)}${tags(c)}</strong><small>${esc(c.group || '未分组')}${c.custom ? '' : ' · 内置源不可删'}</small></span>
        </button>`;
      }).join('');
    } else {
      $('channelList').innerHTML = list.map((c, i) => {
        const index = channels.indexOf(c) + 1;
        return `<button class="channel-card${c.id === currentId ? ' active' : ''}${c.custom ? ' custom' : ''}" data-id="${esc(c.id)}" title="${esc(c.url)}">
          <span class="card-index">${String(index).padStart(2, '0')}</span>
          <span class="card-body"><strong>${esc(c.name)}${tags(c)}</strong><small>${esc(c.group || '未分组')}</small></span>
          ${c.custom ? `<span class="card-del" data-del="${esc(c.id)}" title="删除">✕</span>` : ''}
        </button>`;
      }).join('');
    }

    $('emptyState').hidden = list.length > 0;
    $('batchBar').hidden = !batchMode;
    $('btnBatch').textContent = batchMode ? '完成' : '管理';
    $('btnBatch').classList.toggle('active', batchMode);
    $('batchCount').textContent = '已选 ' + selected.size + ' 个';
    const visibleCustom = channels.filter((c) => c.custom && (activeGroup === '全部' || c.group === activeGroup));
    const allSelected = visibleCustom.length > 0 && visibleCustom.every((c) => selected.has(c.id));
    $('btnSelectAll').textContent = allSelected ? '全不选' : '全选';
  }

  /* ---------------- 批量 / 分组删除 ---------------- */
  function stopPlayback() {
    if (hls) { hls.destroy(); hls = null; }
    video.pause();
    video.removeAttribute('src');
    video.load();
    currentId = null;
    $('nowTitle').textContent = '尚未播放';
    $('nowGroup').textContent = '—';
    $('streamLine').textContent = '请点右上角「+」添加你自己的直播源；下方是国外测试源，国内可能连不上';
    $('videoPlaceholder').hidden = false;
    $('liveBadge').hidden = true;
    $('nowDot').classList.remove('on');
    setLoading(false);
  }

  // 只删除自定义频道，内置测试源始终保留
  function removeChannelsByIds(ids) {
    const deleteSet = new Set(ids);
    channels = channels.filter((c) => !deleteSet.has(c.id) || !c.custom);
    if (currentId && deleteSet.has(currentId)) stopPlayback();
    selected.clear();
    save();
    render();
  }

  function deleteGroup(group) {
    if (!group || group === '全部') { toast('「全部」不能删除'); return; }
    const targets = channels.filter((c) => c.custom && c.group === group);
    if (!targets.length) { toast('分组「' + group + '」没有可删除的频道'); return; }
    if (!window.confirm('确定删除分组「' + group + '」下的 ' + targets.length + ' 个频道？此操作不可恢复，建议先导出备份。')) return;
    removeChannelsByIds(targets.map((c) => c.id));
    toast('已删除分组「' + group + '」的 ' + targets.length + ' 个频道');
  }

  function deleteSelected() {
    const ids = Array.from(selected).filter((id) => {
      const c = channels.find((x) => x.id === id);
      return c && c.custom;
    });
    if (!ids.length) { toast('请先勾选要删除的频道（内置测试源不可删）'); return; }
    if (!window.confirm('确定删除选中的 ' + ids.length + ' 个频道？此操作不可恢复，建议先导出备份。')) return;
    removeChannelsByIds(ids);
    toast('已删除 ' + ids.length + ' 个频道');
  }

  function selectAllVisible() {
    const visible = channels.filter((c) => c.custom && (activeGroup === '全部' || c.group === activeGroup));
    const allSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));
    visible.forEach((c) => { if (allSelected) selected.delete(c.id); else selected.add(c.id); });
    render();
  }

  function toggleBatchMode(on) {
    batchMode = !!on;
    selected.clear();
    render();
    if (batchMode) toast('点频道勾选，完成后点「删除」；内置测试源不可选');
  }

  /* ---------------- 播放 ---------------- */
  function setLoading(on) {
    $('spinner').hidden = !on;
    if (on) $('videoPlaceholder').hidden = true;
  }

  function clearLoadTimer() { clearTimeout(loadTimer); loadTimer = null; }

  // 探测代理服务是否在运行：请求代理根路径，本地代理无 url 参数会回 400，
  // 但只要能拿到 HTTP 响应就说明服务在跑；连不上则 fetch 抛错。
  async function proxyAlive() {
    if (!proxyPrefix) return null;
    const base = proxyPrefix.split('?')[0];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      await fetch(base, { signal: controller.signal, cache: 'no-store' });
      return true;
    } catch (e) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function streamHint(ch) {
    if (!ch) return '播放失败：源不可用';
    if (needProxy(ch)) {
      const alive = await proxyAlive();
      if (alive === false) {
        return '代理服务没在运行：请双击「启动本地代理.bat」，保持黑色窗口开着，再重新点频道';
      }
      return '代理已连接，但该源取不到数据：可能是源已失效，点「更多 → 网络诊断」看详情';
    }
    // 已配置代理但仍未走代理，或根本没配置：http 源必须走代理才能跨域读取
    if (/^http:/i.test(ch.url)) {
      return proxyPrefix
        ? '播放失败：该 http 源未走代理，请到「更多 → 代理设置」检查地址是否正确'
        : '播放失败：HTTP 源需要代理才能跨域读取。请到「更多 → 代理设置」填 http://127.0.0.1:8787/?url=（电脑需先双击「启动本地代理.bat」）';
    }
    return '播放失败：源连不上（超时 / 已失效 / 跨域），可用「更多 → 网络诊断」检测';
  }

  function showStreamHint(ch) { streamHint(ch).then((msg) => toast(msg)); }

  // 网络诊断：直接请求源，区分「源连不上」和「播放器问题」
  async function diagnose(ch) {
    if (!ch) return;
    const url = requestUrl(ch);
    const out = $('diagResult');
    out.innerHTML = '正在检测 <b>' + esc(ch.name) + '</b> …';
    openSheet('sheetDiag');

    const usingProxy = needProxy(ch);
    // 用代理时先探测代理服务本身——区分「代理没开」和「源不可用」
    const proxyOk = usingProxy ? await proxyAlive() : null;
    let proxyLine;
    if (!usingProxy) proxyLine = '代理：未启用';
    else if (proxyOk === true) proxyLine = '代理服务：<span class="diag-ok">✓ 运行中</span>';
    else proxyLine = '代理服务：<span class="diag-bad">✗ 没运行 — 请双击「启动本地代理.bat」并保持窗口开着</span>';
    const lines = [
      '页面协议：' + location.protocol,
      '浏览器模式：' + (preferNativeHls() ? '原生 HLS（系统解码）' : 'hls.js'),
      '浏览器 HEVC 解码：' + (hevcSupport() ? '声明支持' : '不支持'),
      '该源编码：' + (ch.codec === 'H265' ? '<b>H265 / HEVC（TS 封装）</b>' : ch.codec === 'H264' ? 'H264 / AVC' : '未探测（播放后显示）'),
      ...(ch.codec === 'H265' ? ['<span class="diag-bad">此源是 HEVC + TS 封装，iOS Safari 不支持（要求 fMP4 封装），会「有声音没图像」；Chrome/Edge 也不解码 HEVC。需服务端转码或换 H264 源。</span>'] : []),
      proxyLine,
      '代理地址：' + (usingProxy ? proxyPrefix : '未配置'),
      '实际请求：' + (usingProxy ? '[代理] ' : '') + url
    ];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const t0 = Date.now();
    try {
      const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      const ms = Date.now() - t0;
      const text = await res.text();
      lines.push('HTTP 状态：' + res.status);
      lines.push('耗时：' + ms + ' ms');
      lines.push('类型：' + (res.headers.get('content-type') || '未知'));
      lines.push('内容预览：' + text.substring(0, 80).replace(/\n/g, ' '));
      lines.push(res.ok && /#EXTM3U/i.test(text) ? '<span class="diag-ok">✓ 源可达且是有效 M3U8</span>' : '<span class="diag-bad">✗ 源返回内容异常</span>');
    } catch (e) {
      if (usingProxy && proxyOk === false) {
        lines.push('<span class="diag-bad">✗ 请求失败 — 根因：本地代理服务没在运行（上面的「代理服务」一项）。请双击「启动本地代理.bat」，保持窗口开着，再重试。</span>');
      } else {
        lines.push('<span class="diag-bad">✗ 请求失败：' + esc(e.name === 'AbortError' ? '超时（10 秒内无响应，源不可达或被网络拦截）' : e.message) + '</span>');
      }
    } finally {
      clearTimeout(timer);
    }
    out.innerHTML = lines.join('<br>');
  }

  function play(channel) {
    if (!channel) return;
    currentId = channel.id;
    retries = 0;
    render();

    $('nowTitle').textContent = channel.name;
    $('nowGroup').textContent = channel.group || '未分组';
    $('streamLine').textContent = (needProxy(channel) ? '[代理] ' : '') + channel.url;
    $('nowDot').classList.remove('on');
    $('liveBadge').hidden = true;
    setLoading(true);
    clearLoadTimer();

    if (hls) { hls.destroy(); hls = null; }
    video.pause();
    video.removeAttribute('src');
    video.load();

    const url = requestUrl(channel);
    const nativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== '';
    const canUseHls = typeof window.Hls !== 'undefined' && window.Hls.isSupported();
    // iOS（含主屏幕 PWA）与桌面 Safari 用原生 HLS：系统硬解 H264/H265，最稳最省电。
    // 关键：iOS 主屏幕 PWA 的 UA 不含 "Safari"，必须靠 isIOSDevice() 识别，
    // 否则误走 hls.js 会因 iOS MediaSource 不支持 HEVC 而「有声音没图像」。
    // 其它浏览器优先 hls.js —— 部分桌面 Chrome canPlayType 返回 maybe 但原生 HLS 实际播不了。
    const nativePreferred = preferNativeHls();
    const useHlsJs = isHls(url) && canUseHls && (!nativePreferred || !nativeHls);

    if (useHlsJs) {
      let codecChecked = false;
      // 不额外发探测请求：直接用 hls.js 已下载的第一个分片判断编码（零重复流量）。
      // 关闭 Worker，否则 FRAG_LOADED 的 payload 会被转移，无法探测编码。
      hls = new window.Hls({ enableWorker: false, backBufferLength: 12, maxBufferLength: 12,
        maxMaxBufferLength: 12, startLevel: -1 });
      hls.on(window.Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(url));
      hls.on(window.Hls.Events.FRAG_LOADED, (evt, data) => {
        if (codecChecked || !data || !data.payload) return;
        codecChecked = true;
        const codec = detectCodecFromTS(data.payload);
        if (channel.codec !== codec) { channel.codec = codec; save(); render(); }
        if (codec === 'H265' && !hevcSupport()) {
          setLoading(false);
          toast('该源是 H265/HEVC 编码，当前浏览器无法解码；请用 Safari，或换 H264 源');
          if (hls) { hls.destroy(); hls = null; }
        }
      });
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => startPlayback());
      hls.on(window.Hls.Events.ERROR, (evt, data) => {
        if (!data || !data.fatal) return;
        // H265 源即使分片取到，浏览器也可能无法解码 —— 优先给出编码提示
        if (channel.codec === 'H265' || (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && !hevcSupport())) {
          if (!codecChecked) {
            codecChecked = true;
            channel.codec = 'H265';
          }
          setLoading(false);
          toast('该源是 H265/HEVC 编码，当前浏览器无法解码；请用 Safari，或换 H264 源');
          if (hls) { hls.destroy(); hls = null; }
          return;
        }
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR && retries < 2) {
          retries++;
          hls.startLoad();
          return;
        }
        if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && retries < 2) {
          retries++;
          hls.recoverMediaError();
          return;
        }
        setLoading(false);
        showStreamHint(channel);
        if (hls) { hls.destroy(); hls = null; }
      });
      hls.attachMedia(video);
    } else if (isHls(url) && !nativeHls && !canUseHls) {
      setLoading(false);
      toast('当前浏览器不支持 HLS 播放');
      return;
    } else {
      video.src = url;
      video.load();
      startPlayback();
    }

    loadTimer = setTimeout(() => {
      if (video.paused) {
        setLoading(false);
        showStreamHint(channel);
      }
    }, 15000);
  }

  function startPlayback() {
    const p = video.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => { /* 浏览器禁止自动播放时，用户点一下播放键即可 */ });
    }
  }

  video.addEventListener('playing', () => {
    clearLoadTimer();
    setLoading(false);
    $('videoPlaceholder').hidden = true;
    $('liveBadge').hidden = false;
    $('nowDot').classList.add('on');
    $('btnPlay').querySelector('.ico-play').hidden = true;
    $('btnPlay').querySelector('.ico-pause').hidden = false;
    showControls();
  });

  video.addEventListener('pause', () => {
    $('btnPlay').querySelector('.ico-play').hidden = false;
    $('btnPlay').querySelector('.ico-pause').hidden = true;
  });

  video.addEventListener('waiting', () => { if (currentId) setLoading(true); });
  video.addEventListener('error', () => {
    if (!currentId) return;
    setLoading(false);
    showStreamHint(channels.find((c) => c.id === currentId));
  });
  video.addEventListener('volumechange', syncVolumeUI);

  function syncVolumeUI() {
    $('volume').value = video.muted ? 0 : video.volume;
    $('btnMute').querySelector('.ico-volume').hidden = video.muted || video.volume === 0;
    $('btnMute').querySelector('.ico-muted').hidden = !(video.muted || video.volume === 0);
  }

  function showControls() {
    shell.classList.add('controls-visible');
    clearTimeout(controlsTimer);
    controlsTimer = setTimeout(() => shell.classList.remove('controls-visible'), 3200);
  }

  /* ---------------- 弹层 ---------------- */
  function openSheet(id) {
    closeSheets(true);
    $('mask').hidden = false;
    const el = $(id);
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('open'));
  }

  function closeSheets(instant) {
    document.querySelectorAll('.sheet').forEach((el) => {
      el.classList.remove('open');
      if (instant) el.hidden = true;
      else setTimeout(() => { if (!el.classList.contains('open')) el.hidden = true; }, 300);
    });
    if (instant || !document.querySelector('.sheet.open')) $('mask').hidden = true;
  }

  /* ---------------- M3U ---------------- */
  function parseM3U(text) {
    const out = [];
    let meta = null;
    let n = 0;
    String(text).split(/\r?\n/).forEach((raw) => {
      const line = raw.trim();
      if (!line) return;
      if (line.startsWith('#EXTINF')) {
        const gm = line.match(/group-title="([^"]*)"/i);
        const nm = line.match(/,\s*([^,]*)$/);
        meta = { name: (nm && nm[1].trim()) || '未命名频道', group: gm ? gm[1] : '' };
      } else if (/^#EXTGRP:/i.test(line)) {
        if (meta) meta.group = line.replace(/^#EXTGRP:/i, '').trim();
      } else if (!line.startsWith('#')) {
        n++;
        out.push({
          id: uid(),
          name: meta ? meta.name : '频道 ' + n,
          group: meta && meta.group ? meta.group : '自定义',
          url: line,
          custom: true
        });
        meta = null;
      }
    });
    return out;
  }

  function exportM3U() {
    if (!channels.length) { toast('没有可导出的频道'); return; }
    const text = '#EXTM3U\n' + channels.map((c) =>
      `#EXTINF:-1 group-title="${String(c.group || '未分组').replace(/"/g, '')}",${c.name}\n${c.url}`
    ).join('\n') + '\n';
    const blob = new Blob([text], { type: 'application/vnd.apple.mpegurl;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '我的直播列表.m3u8';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('已导出 M3U 文件');
  }

  /* ---------------- 事件绑定 ---------------- */
  $('btnBatch').addEventListener('click', () => toggleBatchMode(!batchMode));
  $('btnSelectAll').addEventListener('click', selectAllVisible);
  $('btnBatchCancel').addEventListener('click', () => toggleBatchMode(false));
  $('btnBatchDelete').addEventListener('click', deleteSelected);
  $('btnAdd').addEventListener('click', () => { $('addForm').reset(); $('fGroup').value = '自定义'; openSheet('sheetAdd'); });
  $('btnImport').addEventListener('click', () => openSheet('sheetImport'));
  $('btnMore').addEventListener('click', () => openSheet('sheetMore'));
  $('btnInstall').addEventListener('click', () => openSheet('sheetInstall'));
  $('btnInstall2').addEventListener('click', () => openSheet('sheetInstall'));
  $('btnDiag').addEventListener('click', () => {
    const ch = channels.find((c) => c.id === currentId);
    diagnose(ch || channels[0]);
  });
  $('btnProxy').addEventListener('click', () => {
    $('proxyInput').value = proxyPrefix;
    openSheet('sheetProxy');
  });
  $('btnProxySave').addEventListener('click', () => {
    const value = $('proxyInput').value.trim();
    if (value && !/\?/.test(value)) { toast('代理地址应包含 ?url= 参数'); return; }
    saveProxy(value);
    closeSheets();
    toast(value ? '代理已保存' : '已关闭代理');
  });
  $('btnProxyClear').addEventListener('click', () => {
    $('proxyInput').value = '';
    saveProxy('');
    toast('已关闭代理');
  });
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeSheets()));
  $('mask').addEventListener('click', () => closeSheets());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheets(); });

  $('addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('fName').value.trim();
    const url = $('fUrl').value.trim();
    const group = $('fGroup').value.trim() || '自定义';
    if (!name || !url) return;
    if (channels.some((c) => c.url === url)) { toast('该地址已存在'); return; }
    // 勾选=强制代理；未勾选=null 表示按页面协议自动判断（http 源 + https/file 页面自动走代理）
    const ch = { id: uid(), name, url, group, custom: true, proxy: $('fProxy').checked ? true : null };
    channels.unshift(ch);
    save();
    clearSearch();
    activeGroup = '全部';
    closeSheets();
    play(ch);
    toast('频道已添加');
    // 编码标签由播放时的 FRAG_LOADED 用已下载分片判定，不再额外发探测请求（省一次 13MB 下载）
  });

  $('btnPickFile').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { $('m3uText').value = String(reader.result || ''); toast('文件已读取，点击「导入」确认'); };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  });

  $('btnDoImport').addEventListener('click', () => {
    const text = $('m3uText').value.trim();
    if (!text) { toast('请先粘贴或选择 M3U 文件'); return; }
    const added = parseM3U(text).filter((c) => !channels.some((x) => x.url === c.url));
    if (!added.length) { toast('没有新增频道（可能全部重复）'); return; }
    channels = channels.concat(added);
    save();
    activeGroup = '全部'; clearSearch();
    render();
    $('m3uText').value = '';
    closeSheets();
    toast('成功导入 ' + added.length + ' 个频道');
  });

  $('btnExport').addEventListener('click', () => { closeSheets(); exportM3U(); });
  $('btnReset').addEventListener('click', () => {
    if (!window.confirm('确定恢复默认频道？你自己添加的频道会被清除，建议先导出备份。')) return;
    if (hls) { hls.destroy(); hls = null; }
    video.pause(); video.removeAttribute('src'); video.load();
    currentId = null; activeGroup = '全部'; clearSearch();
    try { localStorage.removeItem(KEY); } catch (e) {}
    load(); render();
    $('nowTitle').textContent = '尚未播放';
    $('nowGroup').textContent = '—';
    $('streamLine').textContent = '请点右上角「+」添加你自己的直播源；下方是国外测试源，国内可能连不上';
    $('videoPlaceholder').hidden = false;
    $('liveBadge').hidden = true;
    $('nowDot').classList.remove('on');
    closeSheets();
    toast('已恢复默认频道');
  });

  $('searchInput').addEventListener('input', (e) => {
    query = e.target.value;
    $('btnClearSearch2').hidden = !query;
    render();
  });
  $('btnClearSearch').addEventListener('click', clearSearch);
  $('btnClearSearch2').addEventListener('click', clearSearch);

  // 长按分组标签 650ms 一键删除该分组下的自定义频道；电脑用右键同样触发。
  // 长按后会补发 click，用 longPressFired 吞掉这一次，避免误切换分组。
  let pressTimer = null;
  let longPressFired = false;
  $('tabs').addEventListener('pointerdown', (e) => {
    const tab = e.target.closest('.tab[data-group]');
    longPressFired = false;
    if (!tab || tab.dataset.group === '全部') return;
    const group = tab.dataset.group;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => { longPressFired = true; deleteGroup(group); }, 650);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => {
    $('tabs').addEventListener(type, () => { clearTimeout(pressTimer); pressTimer = null; });
  });
  $('tabs').addEventListener('contextmenu', (e) => {
    const tab = e.target.closest('.tab[data-group]');
    if (!tab || tab.dataset.group === '全部') return;
    e.preventDefault();
    deleteGroup(tab.dataset.group);
  });
  $('tabs').addEventListener('click', (e) => {
    if (longPressFired) { longPressFired = false; return; }
    const tab = e.target.closest('.tab');
    if (!tab) return;
    activeGroup = tab.dataset.group;
    selected.clear();
    render();
  });

  $('channelList').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      const id = del.dataset.del;
      channels = channels.filter((c) => c.id !== id);
      if (currentId === id) {
        currentId = null;
        if (hls) { hls.destroy(); hls = null; }
        video.pause(); video.removeAttribute('src'); video.load();
        $('nowTitle').textContent = '尚未播放';
        $('nowGroup').textContent = '—';
        $('streamLine').textContent = '请点右上角「+」添加你自己的直播源；下方是国外测试源，国内可能连不上';
        $('videoPlaceholder').hidden = false;
        $('liveBadge').hidden = true;
        $('nowDot').classList.remove('on');
      }
      save(); render(); toast('频道已删除');
      return;
    }
    const card = e.target.closest('.channel-card');
    if (!card) return;
    if (batchMode) {
      const id = card.dataset.batch;
      if (!id) { toast('内置测试源不可删除'); return; }
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      render();
      return;
    }
    const ch = channels.find((c) => c.id === card.dataset.id);
    if (ch) play(ch);
  });

  $('btnPlay').addEventListener('click', () => {
    if (!currentId) { toast('请先选择一个频道'); return; }
    if (video.paused) startPlayback(); else video.pause();
  });
  $('btnReload').addEventListener('click', () => {
    if (!currentId) { toast('请先选择一个频道'); return; }
    play(channels.find((c) => c.id === currentId));
  });
  $('btnMute').addEventListener('click', () => { video.muted = !video.muted; syncVolumeUI(); });
  $('volume').addEventListener('input', (e) => {
    video.volume = Number(e.target.value);
    video.muted = video.volume === 0;
    syncVolumeUI();
  });
  $('btnFullscreen').addEventListener('click', () => {
    if (video.webkitEnterFullscreen) {
      try { video.webkitEnterFullscreen(); return; } catch (e) { /* 继续尝试其它方式 */ }
    }
    if (video.requestFullscreen) video.requestFullscreen().catch(() => {});
    else if (shell.requestFullscreen) shell.requestFullscreen().catch(() => {});
  });
  shell.addEventListener('click', (e) => {
    if (e.target.closest('.video-controls')) return;
    if (currentId) showControls();
  });

  /* ---------------- 启动 ---------------- */
  loadProxy();
  load();
  render();
  syncVolumeUI();
  video.volume = 1;

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();

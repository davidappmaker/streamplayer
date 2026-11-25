/**
 * Cloudflare Worker：HLS 反向代理
 * 用途：解决「HTTP 源 / 跨源 302 / 无 CORS 头」导致网页播放器无法播放的问题。
 *
 * 部署：
 *   1. 登录 Cloudflare → Workers & Pages → Create Worker
 *   2. 把本文件全部内容粘贴进去，Deploy
 *   3. 得到地址如 https://my-proxy.xxx.workers.dev
 *   4. 在播放器的「更多 → 代理设置」里填入 https://my-proxy.xxx.workers.dev/?url=
 *
 * 请求格式：GET https://<你的worker>/?url=<原始 m3u8 或 ts 地址>
 * 说明：代理只做转发，不缓存、不存储任何视频内容。
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400'
};

function proxyURL(original, base, proxyBase) {
  const absolute = new URL(original, base).href;
  return proxyBase + '?url=' + encodeURIComponent(absolute);
}

function rewriteLine(line, base, proxyBase) {
  // 处理 #EXT-X-KEY 等标签里的 URI="..." 属性
  if (line.indexOf('URI="') !== -1) {
    line = line.replace(/URI="([^"]+)"/g, (match, uri) => {
      try { return 'URI="' + proxyURL(uri, base, proxyBase) + '"'; }
      catch (e) { return match; }
    });
  }
  const trimmed = line.trim();
  // 注释行和空行保持原样
  if (!trimmed || trimmed.charAt(0) === '#') return line;
  // 分片地址 / 子播放列表地址：相对路径转绝对，再包一层代理
  try { return proxyURL(trimmed, base, proxyBase); }
  catch (e) { return line; }
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const incoming = new URL(request.url);
    const target = incoming.searchParams.get('url');
    if (!target) {
      return new Response('Missing ?url= parameter', { status: 400, headers: CORS });
    }

    let upstream;
    try {
      upstream = await fetch(target, { redirect: 'follow' });
    } catch (err) {
      return new Response('Upstream fetch failed: ' + (err && err.message ? err.message : 'unknown'), {
        status: 502, headers: CORS
      });
    }

    const contentType = upstream.headers.get('content-type') || '';
    const finalUrl = upstream.url || target;
    const proxyBase = incoming.origin + incoming.pathname;
    const isPlaylist = /mpegurl|m3u8/i.test(contentType) || /#EXTM3U/i.test(target);

    if (!isPlaylist) {
      // ts / mp4 分片：流式透传，只补 CORS 头
      return new Response(upstream.body, {
        status: upstream.status,
        headers: Object.assign({}, CORS, {
          'Content-Type': contentType || 'video/mp2t',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store'
        })
      });
    }

    // m3u8 播放列表：把里面每一个分片地址改写成代理地址
    const text = await upstream.text();
    const rewritten = text.split(/\r?\n/).map((line) => rewriteLine(line, finalUrl, proxyBase)).join('\n');

    return new Response(rewritten, {
      status: 200,
      headers: Object.assign({}, CORS, {
        'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'Cache-Control': 'no-store'
      })
    });
  }
};

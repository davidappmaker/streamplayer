/**
 * 本地代理服务（Node.js 版）
 * 用途：在电脑上播放「http 源 / 302 跳裸 IP / 无 CORS 头」的直播源。
 *
 * 运行方法：
 *   1. 安装 Node.js（https://nodejs.org）
 *   2. 在本文件所在目录打开命令行，执行：node proxy-server.js
 *   3. 保持窗口开着，不要关闭
 *   4. 播放器 → 更多 → 代理设置 → 填 http://127.0.0.1:8787/?url=
 *
 * 只监听本机 127.0.0.1，不对外暴露；只做转发，不存储任何内容。
 */
const http = require('http');
const { URL } = require('url');

const PORT = 8787;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*'
};

function proxyUrl(original, base, prefix) {
  return prefix + '?url=' + encodeURIComponent(new URL(original, base).href);
}

function rewriteLine(line, base, prefix) {
  if (line.indexOf('URI="') !== -1) {
    line = line.replace(/URI="([^"]+)"/g, (match, uri) => {
      try { return 'URI="' + proxyUrl(uri, base, prefix) + '"'; } catch (e) { return match; }
    });
  }
  const t = line.trim();
  if (!t || t.charAt(0) === '#') return line;
  try { return proxyUrl(t, base, prefix); } catch (e) { return line; }
}

function fetchUpstream(target, redirects, cb) {
  if (redirects > 5) return cb(new Error('too many redirects'));
  let u;
  try { u = new URL(target); } catch (e) { return cb(new Error('bad url')); }
  const mod = u.protocol === 'https:' ? require('https') : require('http');
  const req = mod.get(u, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      'Accept': '*/*'
    }
  }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      return fetchUpstream(new URL(res.headers.location, u).href, redirects + 1, cb);
    }
    cb(null, res, u.href);
  });
  req.on('error', cb);
  req.setTimeout(20000, () => req.destroy(new Error('upstream timeout')));
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }
  const parsed = new URL(req.url, 'http://127.0.0.1:' + PORT);
  const target = parsed.searchParams.get('url');
  if (!target) {
    res.writeHead(400, CORS);
    return res.end('Missing ?url=');
  }
  const prefix = 'http://127.0.0.1:' + PORT + parsed.pathname;

  let done = false;
  const fail = (msg, code) => {
    if (done || res.headersSent) return;
    done = true;
    res.writeHead(code || 502, CORS);
    res.end(msg);
  };

  fetchUpstream(target, 0, (err, upstream, finalUrl) => {
    if (err) return fail('Upstream error: ' + err.message);
    const ct = upstream.headers['content-type'] || '';
    const isPlaylist = /mpegurl|m3u8/i.test(ct) || /#EXTM3U/i.test(target.toLowerCase());
    if (!isPlaylist) {
      if (done || res.headersSent) return;
      done = true;
      res.writeHead(upstream.statusCode || 200, Object.assign({}, CORS, {
        'Content-Type': ct || 'video/mp2t',
        'Accept-Ranges': 'bytes'
      }));
      return upstream.pipe(res);
    }
    let body = '';
    upstream.setEncoding('utf8');
    upstream.on('data', (chunk) => { body += chunk; });
    upstream.on('error', () => fail('Upstream stream error'));
    upstream.on('end', () => {
      if (done || res.headersSent) return;
      done = true;
      const out = body.split(/\r?\n/).map((l) => rewriteLine(l, finalUrl, prefix)).join('\n');
      res.writeHead(200, Object.assign({}, CORS, {
        'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'Cache-Control': 'no-store'
      }));
      res.end(out);
    });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('本地代理已启动：http://127.0.0.1:' + PORT + '/?url=');
  console.log('保持此窗口开着，在播放器里填入上面的地址即可。');
});

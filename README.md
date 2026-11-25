# 直播源播放器

一个纯前端的直播源播放器，类似「友窝」的使用方式：自己填入直播源地址即可播放。支持 iPhone 添加到主屏幕当 App 用，也支持一键部署到 GitHub Pages。

## 在线地址

**https://davidappmaker.github.io/streamplayer/**

页面已部署到 GitHub Pages，直接用 Safari 打开即可；iPhone 用 Safari 打开后点分享 →「添加到主屏幕」就能当 App 用。

## 功能

- 播放 M3U8 / HLS 直播流（iPhone Safari 用原生 HLS，其他浏览器自动加载 hls.js）以及 MP4 等浏览器支持的格式
- 频道分组、搜索、最近播放高亮
- 手动添加 / 删除频道，M3U 列表批量导入、导出备份
- 播放 / 暂停、静音、音量、刷新、全屏（iPhone 调用原生全屏）
- 频道数据保存在浏览器本地（localStorage），不上传任何服务器
- PWA：可添加到 iPhone 主屏幕，全屏运行、支持离线打开界面（不缓存视频流）

## 文件说明

```
index.html            主页面
styles.css            样式
app.js                播放器逻辑与本地存储
hls.min.js            hls.js 1.5.17（本地内置，不依赖外部 CDN）
worker.js             可选：部署到 Cloudflare Workers 的 HLS 反向代理
proxy-server.js       可选：本地 Node.js 代理（电脑上使用）
启动本地代理.bat      双击启动本地代理的一键脚本（Windows）
manifest.webmanifest  PWA 配置
sw.js                 Service Worker（只缓存界面，不缓存视频）
icon-180/192/512.png  桌面图标
```

## 部署到 GitHub Pages

### 方式一：网页上传（最简单）

1. 打开 <https://github.com/new>，新建一个仓库，例如 `live-player`
2. 仓库权限选 **Public**，不要勾选 README / .gitignore（保持空仓库）
3. 进入仓库 → **Add file** → **Upload files**，把本目录所有文件拖进去，点 **Commit changes**
4. 进入仓库 **Settings** → **Pages**
5. **Build and deployment** 中 Source 选 **Deploy from a branch**，Branch 选 `main`，目录选 `/ (root)`，点 **Save**
6. 等 1–2 分钟，页面会显示访问地址：`https://<你的用户名>.github.io/live-player/`

### 方式二：命令行

```bash
cd 本项目目录
git init
git add .
git commit -m "init live player"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

然后在仓库 Settings → Pages 中按上面第 5 步开启 Pages。

> 更新内容：改完文件后重新提交并 push，或直接在网页上编辑，Pages 会自动重新发布。

## iPhone 添加到桌面

1. **必须用 Safari** 打开你的 GitHub Pages 地址（微信/Chrome 内打开无法添加）
2. 点底部中间的「分享」按钮（方框向上箭头）
3. 下滑找到「添加到主屏幕」→ 点「添加」
4. 回到桌面，点新图标即可全屏使用

> GitHub Pages 自带 HTTPS，满足 PWA 的安全要求。如果用局域网 IP 本地测试，iPhone 不会显示「添加到主屏幕」——这是浏览器的安全限制，部署到 GitHub Pages 后正常。

## 使用说明

- 右上角 **+**：添加单个频道（名称 + 直播源地址 + 分组）
- 右上角 **⬇**：导入 M3U 文件或直接粘贴 M3U 文本，支持 `group-title` 分组
- 右上角 **⋯**：导出 M3U 备份、查看安装说明、恢复默认频道
- 点频道卡片开始播放；自己添加的频道右上角有 `✕` 可删除
- 默认内置 4 个公开测试流，仅用于验证播放器是否工作

## 播放不了某些源？关于代理

有些直播源（尤其是运营商的源）无法在网页里直接播放，典型特征：

- 地址是 `http://` 开头，而你的播放器部署在 `https://` 上 → 浏览器按「混合内容」规则直接拦截
- 请求后 302 跳转到另一个域名或裸 IP，且最终服务器不返回 `Access-Control-Allow-Origin` → 浏览器 CORS 策略拦截

例如 `http://ott.fj.chinamobile.com/.../index.m3u8?tenantId=8601` 就属于这种情况：源本身有效，但会跳到裸 IP 且没有 CORS 头。**纯前端无法绕过浏览器这两条安全规则，必须通过反向代理。**

### 方案 A：本地代理（电脑上立即可用，推荐先试这个）

项目自带 `proxy-server.js`，不用注册任何账号：

1. 电脑安装 Node.js（<https://nodejs.org>）
2. **双击 `启动本地代理.bat`**，保持弹出的窗口开着
3. 播放器 → 更多 → 代理设置 → 填 `http://127.0.0.1:8787/?url=` → 保存
4. 添加这个直播源，勾选「强制通过代理播放」，即可播放

> 此代理只监听本机 `127.0.0.1`，不对外暴露。缺点是只在运行代理的那台电脑上有效，iPhone 用不了（iPhone 请用下面的 Cloudflare 方案）。

**开了代理还是播不了？** 点「更多 → 网络诊断」，它会直接告诉你：
- `代理服务：✓ 运行中` —— 代理正常，往下看 HTTP 状态和编码提示
- `代理服务：✗ 没运行` —— **黑窗口被关掉了**，重新双击 `启动本地代理.bat` 并保持窗口开着即可

绝大多数「开了代理两个源都打不开」的情况，都是代理窗口被关掉或启动时没成功，诊断面板会明确指出来。

### 方案 B：Cloudflare Worker（手机 + 电脑都能用）

项目自带的 `worker.js` 是一个免费可用的 HLS 代理，部署方法：

1. 登录 [Cloudflare](https://dash.cloudflare.com/)，进入 **Workers & Pages → Create Worker**
2. 随便起个名字，点 **Deploy**
3. 点 **Edit code**，把 `worker.js` 的全部内容粘贴进去，覆盖默认代码，再点 **Deploy**
4. 记下生成的地址，类似 `https://my-proxy.xxx.workers.dev`
5. 回到播放器：**更多 → 代理设置**，填入 `https://my-proxy.xxx.workers.dev/?url=` 并保存
6. 重新添加这个直播源（添加时勾选「强制通过代理播放」），http 源在 https 或 file 协议下会自动走代理

代理会自动把 m3u8 里的分片地址也改写成代理地址，所以 ts 分片同样能正常读取。它只做实时转发，不缓存、不存储任何内容。Cloudflare 免费额度对个人观看绰绰有余。

> 如果某个源在代理下仍然失败，多半是源服务器校验了 User-Agent / Referer / 防盗链，这种限制在纯前端环境里同样无法绕过。

## 常见问题

**提示「H265/HEVC 编码，当前浏览器无法解码」**
- 这是浏览器解码能力限制，不是网络或播放器故障。H265 编码在 Chrome / Edge 上普遍不支持，hls.js 无法转码。
- 解决办法：① 换用 **Safari**（macOS / iPhone 较新版本支持 HEVC）；② 改用 H264 编码的源。
- 播放器会播放前自动探测编码，并在「更多 → 网络诊断」里显示该源是 H264 还是 H265，以及当前浏览器是否支持 HEVC。

**双击本地 HTML，点默认测试源播不了**
- `file://` 协议本身不影响播放（已实测：本地可达的 M3U8 能正常解析并请求分片）。
- 真正原因是内置测试源都在国外服务器，国内网络经常连不上——这是网络问题，不是播放器坏了。
- 请点右上角「+」添加你自己的直播源；点「更多 → 网络诊断」可以立刻看出源是否可达。

**点了频道一直转圈 / 播放失败**
- 直播源本身失效了，换个地址试试。可在电脑浏览器打开该地址验证，或用「更多 → 网络诊断」检测。
- 源的服务器必须允许跨域（CORS），否则 hls.js 无法读取分片；iPhone Safari 原生 HLS 对此限制较少。
- http 源在 https 页面上会被浏览器拦截为混合内容，按上面的「关于代理」章节配置代理。
- 302 跳转到其它域名且无 CORS 头的源，同样需要代理。

**iPhone 上点播放没声音**
- iOS 禁止无用户手势的自动播放。点一下播放器的播放按钮即可。

**数据会不会同步到别的设备？**
- 不会。频道只存在当前浏览器里，换设备请用「导出 M3U」再导入。

## 免责声明

本项目只是一个通用的视频播放器框架，不内置、不提供、不推荐任何电视直播源，请自行获取并确认你有权使用相关流媒体内容。项目作者不对用户添加的第三方地址及其内容承担任何责任。请遵守所在地区的法律法规。

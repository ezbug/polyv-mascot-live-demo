# H5 直播间 · 吉祥物「小威」Demo

基于保利威观看页 SDK 的 H5 直播间示例：真实播放/聊天/点赞 + 全身体感吉祥物 + 事件互动 + 混合 AI 答疑。

## 运行

```bash
# 在仓库根目录
cd demo
python3 -m http.server 8788
```

打开：

- 一键演示：`http://127.0.0.1:8788/demo.html?channel=你的频道号`
- 自动演示：`http://127.0.0.1:8788/demo.html?channel=你的频道号&auto=1`
- 真实 SDK 调试版：`index-real.html?channel=你的频道号`
- 纯 UI 原型（无需账号）：`index.html`
- 素材看板：`preview.html`

> 频道需为「公开观看 / 白名单」等无需登录的观看条件，否则 SDK 授权会走 fallback。
> 不填 `channel` 时页面会提示未配置频道，宠物层仍可预览。

## AI 代理（可选）

宠物对话需要 `ai-token` 代理：

```bash
cd ai-token
cp .env.example .env
# 编辑 .env：POLYV_APP_ID / POLYV_APP_SECRET / POLYV_AI_ID / DEEPSEEK_API_KEY
node server.mjs        # 端口 8789
```

然后页面里的 `AI.proxy` 默认指向 `http://127.0.0.1:8789`。

## 文件

| 文件 | 说明 |
| --- | --- |
| `demo.html` | 示范页（一键演示 / 自动演示） |
| `index-real.html` | 真实观看页 SDK 版 |
| `index.html` | 纯 UI 原型 |
| `showcase.html` | 29 个动作/表情巡览 |
| `preview.html` | 素材看板 |
| `assets/` | 29 帧 512×512 透明素材 + manifest |
| `tools/build-frames.py` | 投图 → 抠白 / 对齐 / 入库 |
| `tools/check-inbox.py` | 投图自检 |
| `ai-token/server.mjs` | 生产用 AI 代理（Polyv RAG + DeepSeek 混合） |
| `ai-proxy/server.mjs` | 可选：纯 DeepSeek 示例 |

## 素材管线

1. 按 `docs/素材制作指南.md` 准备 PNG
2. 放进 `inbox/`，文件名 = `tools/manifest.json` 里的槽位 id
3. `python3 tools/build-frames.py`
4. 刷新 `demo.html` / `preview.html`

## 说明

- 本项目是非官方示例，与保利威官方无关。
- 不包含任何频道号、账号、密码或 API Key；请使用你自己的 Polyv 频道与 DeepSeek Key。
- 保利威问答接口为官方聊天组件内部接口，上线前请向保利威确认授权与稳定性。

# POLYV 小威 · H5 直播间吉祥物

一个基于 **保利威观看页 SDK** 的 H5 直播间示例：把吉祥物「小威」做成可交互的全身宠物层，叠加答题卡/签到/抽奖等事件互动，并接入「保利威知识库 + DeepSeek 闲聊」的混合 AI 答疑。

![小威](demo/assets/full-neutral.png)

## 功能

- **真实直播层**：播放、聊天、点赞、在线人数来自观看页 SDK
- **全身吉祥物**：29 帧动作/表情/口型/3-4 视角，点击跳、双击转身、拖拽、待机随机小表情
- **事件互动**：答题卡 / 观众提问 / 签到 / 抽奖 / 公告；气泡 + 多表情连招 + 随机台词 + 音效
- **混合 AI**：保利威知识库 RAG 优先，超纲问题切 DeepSeek；SSE 流式回答驱动口型
- **一键演示**：`demo.html` 点「▶ 演示」，或 `?auto=1` 自动播放
- **素材管线**：白底/透明 PNG → 自动抠图 → 512×512 底对齐 → 看板

## 快速开始

```bash
git clone <this-repo>
cd <this-repo>/demo

# 静态页
python3 -m http.server 8788
# 打开 http://127.0.0.1:8788/demo.html?channel=你的频道号

# AI 代理（另开终端）
cd ai-token
cp .env.example .env
# 填 POLYV_APP_ID / POLYV_APP_SECRET / POLYV_AI_ID / DEEPSEEK_API_KEY
node server.mjs
```

## 目录

```
.
├── demo/                 # H5 示例源码
│   ├── demo.html         # 示范页（一键演示）
│   ├── index-real.html   # 真实 SDK 版
│   ├── index.html        # UI 原型
│   ├── showcase.html     # 29 帧巡览
│   ├── assets/           # 512×512 素材 + manifest
│   ├── tools/            # build-frames.py / check-inbox.py
│   ├── ai-token/         # Polyv RAG + DeepSeek 混合代理
│   └── ai-proxy/         # 纯 DeepSeek 示例
├── docs/
│   ├── 交付文档.md
│   ├── 事件互动设计.md
│   ├── 素材制作指南.md
│   ├── 素材提示词.md
│   └── AI助手接入清单.md
├── LICENSE
└── README.md
```

## 配置

| 变量 | 说明 |
| --- | --- |
| `?channel=` | 你的保利威频道号（观看条件需公开/白名单） |
| `POLYV_APP_ID` / `POLYV_APP_SECRET` | 保利威账号 API 凭据（仅服务端） |
| `POLYV_AI_ID` | AI 答疑助手 aiId |
| `DEEPSEEK_API_KEY` | DeepSeek Key（可选；不填则只用保利威知识库） |
| `ALLOWED_ORIGINS` | AI 代理允许的前端来源 |

## 素材

29 个槽位的表情/动作/口型/视角，全部在 `demo/assets/`。生成与投图流程见 [docs/素材制作指南.md](docs/素材制作指南.md)，提示词见 [docs/素材提示词.md](docs/素材提示词.md)。

## 说明

- 本项目为**非官方示例**，与保利威官方无关。
- 仓库内**不包含**任何频道号、账号、密码、API Key 或观看页凭据。
- 保利威问答接口 `/ai/v1/chat/question` 为官方聊天组件内部接口，未公开为正式 API；上线前请向保利威确认授权与稳定性。
- 演示中的 AI 回答仅供参考，请根据业务补充审核与兜底话术。

## License

MIT

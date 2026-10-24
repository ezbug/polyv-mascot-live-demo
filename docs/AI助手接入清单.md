# AI 助手挂件 · 接入准备清单

> 依据：Polyv「AI 答疑助手 SDK」文档 + 实际抓取 `polyv-ai-chat-bot.umd.js`（v latest，2026-10-23）核对实现细节。挂件是**纯前端浮层**，不依赖 3D/GLB。

## 0. 先明确两种用法（决定后面所有条件）

| 用法 | 位置 | 限制 |
| --- | --- | --- |
| 平台内嵌版 | Polyv 直播观看页 | 仅**直播 + 横屏**；点播不支持；竖屏观看页不显示；首条消息不可自定义 |
| 独立 SDK 嵌入 | 自有官网 / 落地页 / 自建观看页 | 文档称"可嵌入网页"；不受观看页竖屏限制（需自行适配移动端） |

## 1. 平台侧要准备（找 Polyv / 后台）

- [ ] 开通 **AI 应用 → AI 答疑助手**，创建助手，拿到 `aiId`
- [ ] 知识库内容：带字幕的点播视频（非加密）或 txt/docx/xlsx，单文件 ≤100MB，单账号 ≤4096 份；建好后用后台「调试助手」验证
- [ ] `appId` + `secretKey`（`secretKey` 只能放服务端，禁止前端）
- [ ] 服务端 Token 接口：`POST https://api.polyv.net/live/v3/common/token/get-ai-token`，参数 `appId / timestamp / viewerId / sign`；前端 `getToken(viewerId)` 调你自己的 `/api/token`
- [ ] 确认套餐/计费与可用频道；确认自有域名的页面是否允许嵌入（文档未写域名白名单）
- [ ] `viewerId` 规则：登录用户用业务 userId，游客用持久化匿名 id（同一 id 才有连续会话）

## 2. 视觉资产（挂件实际尺寸已从 SDK 代码里核实）

- [ ] **widgetIcon（悬浮按钮）**：按钮 48×48 CSS px、圆形裁切（`border-radius:50%`）、底色 = `themeColor`
      → 交付 96×96 / 144×144 PNG（2x/3x，透明底），主体内缩 8–10%，别贴边
      → `widgetIcon` 传 http 地址时渲染为 `<img>`（**GIF 动图可用**）；传非 http 字符串则作为 `innerHTML`（可内联 SVG，自行控制尺寸）
- [ ] **assistantAvatar（对话头像）**：1:1 方形，512 / 256 PNG；圆形显示，脸居中
- [ ] **userAvatar**：可选，默认图即可
- [ ] **themeColor**：从 POLYV 标志采样约 `#355BE0`（JPEG 取样，建议以 VI 色值为准）；影响按钮底色、阴影、加载圈
- [ ] **文案**：`customText.title`（如「保利威小助手」）、`placeholder`、`sendButtonText`；**首条欢迎语不可改**，要靠知识库/回复体现
- [ ] **位置与尺寸**：`position: left|right`（默认 right，距边 20px，z-index 99999）；`width/height` 是**原始 CSS 字符串**（默认 400×600）→ 移动端传 `calc(100vw - 40px)` 之类自适应值
- [ ] **遮挡检查**：避开页面已有的客服/回到顶部悬浮球（同一右下角会重叠）
- [ ] 深色页面 / 浅色页面各出一版预览；375 / 390 宽手机各测一遍

## 3. Tripo / 3D 这条线：哪些用得上、哪些用不上

- 挂件**用不上 GLB / 3D 模型**：SDK 只接受静态图片 URL（或 SVG/HTML 字符串），不能渲染 3D、不能骨骼动画。
- Tripo 需要给挂件/头像导出的只是**2D 静帧**：正面或 3/4 视角、1024×1024、透明底、均匀布光、无地面投影；再缩 512/256。
- 3D 模型真正用得上的是这些位置：直播虚拟主播（OBS 场景）、暖场视频、视频创作背景、未来自建 3D 数字人。
- 如果要做「会动的 3D 挂件」：SDK 不支持，只能自建浮层（three.js / `<model-viewer>` 渲染模型 + 自己的对话 UI 调 AI 接口），成本另算。
- Polyv 平台「数字人」形象库/定制（1:1 真人还原）**吃不了 Tripo 模型**，别把 3D 模型预期挂在平台数字人上。

## 4. 最小初始化代码（核对 SDK 后的写法）

```html
<script src="https://websdk.videocc.net/ai-chat-bot/latest/polyv-ai-chat-bot.umd.js"></script>
<script>
PolyvAIChatBot.polyvAIChat.init({
  aiId: '你的aiId',
  getToken: async (viewerId) => (await fetch(`/api/token?viewerId=${viewerId}`)).json().data,
  position: 'right',
  width: window.innerWidth < 480 ? 'calc(100vw - 40px)' : '400px',
  height: window.innerWidth < 480 ? '70vh' : '600px',
  customText: { title: '保利威小助手', placeholder: '输入问题…', sendButtonText: '发送' },
  customUi: {
    themeColor: '#355BE0',
    widgetIcon: '/assets/widget-144.png',   // 48px 圆形显示
    assistantAvatar: '/assets/avatar-512.png',
  },
});
</script>
```

## 5. 上线前测试清单

- [ ] 弹窗宽高在 375 / 768 / 1440 宽下不溢出、不遮挡输入框
- [ ] 键盘弹出（iOS Safari / Android）时输入框可见
- [ ] 按钮 48px 圆裁后主体完整、深色页面可读
- [ ] token 过期/刷新后会话是否延续
- [ ] 关闭按钮（切换为白色 X）位置正常
- [ ] 与页面滚动、z-index、其他悬浮球不冲突
- [ ] 知识库回答准确性（用「调试助手」+ 真机各测 10 问）

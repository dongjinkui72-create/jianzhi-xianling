# 剪纸仙灵

一个**免费开源**的手机 App（Expo / React Native），专门帮你把各家 AI 厂商和中转站的免费 API 额度薅干净。

免注册、免登录、打开即用，没有任何账号体系。**交付形态只有手机 App**，不提供网页 / H5 / 小程序版本。

---

## 一分钟上手

```bash
cd jianzhi-xianling
npm install
npx expo start          # 扫码用 Expo Go 先看看界面
```

> ⚠️ 想让「自动识别已安装的聊天软件」真正生效，必须用**开发版**而不是 Expo Go：
>
> ```bash
> npx expo prebuild --clean
> npx expo run:android   # 需要 Android SDK；iOS 用 npx expo run:ios（需 macOS）
> ```
>
> 原因见下方「能力边界」。在 Expo Go 里，App 会把扫描结果如实标成**「无法确认」**，
> 而不会谎报「未安装」。

---

## 两个核心功能（不可缺）

### ① 在中转站自动创建 API 密钥并保存到本机

「中转站」页 → 选一个站点 → 「打开并登录」→ 在 App 内置浏览器里正常登录。
登录成功后 App 会**自动**完成：

1. 通过页面内 `fetch` 桥接读取登录态（HttpOnly 的 session cookie 由 WebView 自己带上，无需用户复制任何东西）
2. 探测站点架构（`GET /api/status`）
3. 读取账号与余额（`GET /api/user/self`）
4. 创建**系统访问令牌**（`POST /api/user/access_tokens`）并存进 SecureStore —— 之后签到 / 查余额都不用再开网页
5. 创建 API Key（`POST /api/token/`）→ 列表定位（`GET /api/token/?p=1&page_size=100`）→ 取回完整密钥（`POST /api/token/:id/key`）
6. 密钥写入 SecureStore，调用地址 + **掩码**写入 SQLite

适配 New API / One API 架构（国内绝大多数中转站都是这套开源面板）。
接口路径与响应结构均已对照上游源码核对，见 `src/services/relayApi.ts` 顶部注释。

**做不到时如实说**：站点面板不是这套架构、或只返回掩码且不开放完整 Key 查询时，
UI 会明确告诉你「这个站点没法自动建档」，并给出手动粘贴入口，绝不假装成功。

### ② 点启动按钮 → 拉起聊天软件 → 全自动导入，零复制粘贴

启动走的是 **Chatbox 官方的「导入第三方提供方配置」deep link**（自 v1.15.1 起支持）：

```
chatbox://app/import-config?type=<TYPE>&data=<BASE64(JSON)>
JSON = { "apiHost": "https://your-relay.com/v1", "apiKey": "sk-...", "name": "备注名" }
TYPE = openai_compatible | openai_response | gemini | claude | ollama | lmstudio
```

由 Chatbox 自己解析并写入配置，**全程不经过剪贴板**，用户不需要复制粘贴任何字符。
密钥明文只从本机 SecureStore 读出后直接交给目标 App。

其它聊天软件若没有公开同类协议，App 只会「拉起」并**明确标注**
`仅能打开` / `导入能力无法确认`，不会谎报「已导入」。

---

## 三个入口 + 一个圆形启动按钮

底部导航（比常规更高）：

```
[ 雷达站 ]  [ 中转站 ]  ( ▶ 启动 )  [ 可用池 ]
```

圆形启动按钮正好夹在「中转站」和「可用池」中间，**面积是标准 FAB 的 2 倍**
（56 → 80，`(80/56)² ≈ 2.04`）。未选中 API 时它是灰色且不可点击的。

- **雷达站**：只有「官方」和「中转站」两个分区，顶部**没有**分组筛选条。
  每天自动抓取厂商定价页与中转站首页（关键词 `api`），每条都写清「怎么领」的步骤。
  内置种子库离线兜底，保证中转站分区 ≥ 5 条（实际内置 12 条）。
- **中转站**：顶部一键签到（可一次签到多个已保存站点，结果只写本机日志），
  下面是本地已保存的站点（名称 + 链接 + 剩余 token），**默认折叠**，每行都有展开按钮。
- **可用池**：打开即自动体检，筛出绿色 / token 充足的 API；
  额度不足或失效的**静默标红移入预警区**（App 永远不会提示「建议删除该 API」）。
  「未选择 API + 启动」这一块**居中**放在底部「可用池」那一行的上面。

设置入口固定在**主界面右上角**。

---

## 数据分层（产品红线）

| 层 | 位置 | 内容 |
| --- | --- | --- |
| 公开情报 | 云端（匿名可读） | `providers` / `benefits` / `relays` / `clients` |
| 私有数据 | 本机 SQLite | 站点档案、API **掩码**、签到日志、自建软件、设置 |
| 敏感数据 | 本机加密区 SecureStore | 真实 API Key、系统访问令牌 |

数据库里的 Key 一律是 `sk-abc****wxyz` 这种掩码。**App 不向任何服务器上传你的密钥或签到记录。**

---

## 抓取数据的边界归一化与噪声排除

外部页面很容易把「262,144 tokens 上下文窗口」误判成赠送额度。
`src/lib/normalize.ts` 用三道防线拦住：

1. **文本归一化**：全角转半角、NFKC、压缩空白、去零宽字符
2. **噪声排除**：数字邻域若出现「上下文 / context window / 最大输出 / 速率限制」等词，
   且噪声词比福利词更靠近数字，直接丢弃
3. **边界归一化**：数字必须紧邻明确的额度单位（tokens / $ / ¥ / 次 / 天），
   中文数量级（万、亿）与英文数量级（K/M/B）统一折算；块级 HTML 标签转换行以正确断句

跑一遍验证：

```bash
npm run verify
```

覆盖 27 项断言，包含「混排句里必须取 `$5` 而不是 `262,144 tokens`」这类回归用例。

---

## 能力边界（做不到就如实标注）

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 自动建档 API Key | ✅ New API / One API | 其它架构标「不支持」+ 手动入口 |
| 一键签到 | ⚠️ 视站点 | 未开启签到 / 强制 Turnstile 人机验证的站点标「只能手动」，日志记 `manual_only`，**绝不伪造成功** |
| 全自动导入聊天软件 | ✅ Chatbox | 其它软件标「仅能打开」或「无法确认」 |
| 扫描已安装软件 | ⚠️ 需开发版 | Android 11+ 包可见性 / iOS `LSApplicationQueriesSchemes` 都要原生壳预声明白名单，见 `plugins/withChatAppQueries.js`。Expo Go 里无法扩展 → 一律标「无法确认」 |
| 余额查询 | ⚠️ 视站点 | 站点没开放 `dashboard/billing` 时标「仅确认连通」 |
| 网络不可达 | — | 标「无法确认」，**不会**谎报「已失效」 |

---

## 界面

- **iPhone 水晶玻璃主题**，配色固定为**水晶白且不可更改**（`src/theme/tokens.ts` 里是常量，App 内没有换肤入口）
- 大屏小屏自适应：以 390pt 逻辑宽度为基准等比缩放，夹在 `[0.86, 1.30]`，
  字号再乘系统字体缩放（同样限幅），小屏不挤爆、大屏不空荡（`src/theme/useScale.ts`）

---

## 目录结构

```
App.tsx                       启动 + 数据库就绪闸门
plugins/withChatAppQueries.js 原生壳白名单（Android <queries> / iOS LSApplicationQueriesSchemes）
scripts/verify-core.js        核心逻辑验证（27 项）
src/
  theme/                      水晶玻璃主题、大小屏缩放
  components/                 Glass / Header / Bits（Chip、Sheet、Notice…）
  navigation/                 RootNavigator + CrystalTabBar（含圆形启动按钮）
  launch/LaunchProvider.tsx   启动流程编排：选软件 → deep link 全自动导入 → 如实回报
  screens/
    RadarScreen.tsx           雷达站（官方 / 中转站）
    RelayScreen.tsx           中转站（签到 + 本地站点折叠列表 + 手动入口）
    RelayWebScreen.tsx        内嵌浏览器登录 + 自动建档
    PoolScreen.tsx            可用池（体检 / 预警区 / 底部启动坞）
    SettingsScreen.tsx        设置（右上角进入）
  services/
    relayApi.ts               New API / One API 接口层
    relayBridge.ts            WebView 页面内 fetch 桥接（带 HttpOnly Cookie）
    healthCheck.ts            可用池体检
    detectApps.ts             已安装聊天软件识别（含「无法确认」判定）
    launcher.ts               deep link 构造与启动
    radarFeed.ts              情报抓取（远程 JSON → 实抓官网 → 内置种子，逐层降级）
  data/
    db.ts                     SQLite（本机私有数据）
    vault.ts                  SecureStore（真实密钥）
    seed.ts                   内置情报种子库 + 站点目录
    chatAppRegistry.ts        聊天软件登记表
  lib/                        normalize / format / base64 / types / id
```

---

## 免责

内置站点目录仅为公开信息整理，**本 App 不代收任何费用、不经手你的充值**。
第三方中转站的可信度请自行甄别。额度情报来自公开页面抓取，厂商政策随时会变，实际以官网为准。

## License

MIT
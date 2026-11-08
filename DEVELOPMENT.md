# SF6 Scorer 开发文档

> 实时显示《街头霸王6》LP/MR 分数变化趋势的桌面应用
> 版本：v0.1（技术栈已锁定）
> 状态：开发文档

---

## 1. 项目概述

### 1.1 目标

做一个 Windows 桌面应用，准实时追踪《街霸6》玩家（自己或任意 CFN ID）的排位分数变化，并提供：

- 主窗口：概览、对战记录/详情、角色统计、赛季报告、导出/备份、同步诊断、设置
- 图表弹窗：Mini 分数悬浮窗 / Pro 趋势图（最近 20 场），按需打开
- OBS 直播叠加：透明置顶窗或浏览器源 overlay
- 多账号追踪：自己 + 任意 CFN ID

### 1.2 非目标（本期不做）

- 不做游戏内存读取 / 反作弊绕过
- 不做录像下载、回放分析
- 不做云端账号体系与跨设备同步
- 不做移动端

### 1.3 定位说明

数据源是 Capcom 官方 Buckler's Boot Camp 的页面数据，**非官方 REST API**，存在更新延迟与改版风险。产品定位为「准实时」（轮询间隔 15–30s），UI 必须标注数据时间。

---

## 2. 技术栈（锁定）

| 层              | 选型                       | 版本基线                            | 说明                                      |
| --------------- | -------------------------- | ----------------------------------- | ----------------------------------------- |
| 运行时          | Node.js                    | 26.x（本机）/ 24.x（Electron 内置） | 主进程与构建                              |
| 语言            | TypeScript                 | 5.9.x                               | 全栈统一，`strict: true`                  |
| 桌面壳          | Electron                   | 45.x                                | 悬浮窗/透明/置顶/OBS                      |
| 构建            | Vite                       | 8.x                                 | 渲染进程                                  |
| Electron 集成   | electron-vite              | 6.x                                 | main/preload/renderer 三端构建            |
| UI              | React                      | 19.x                                | 函数组件 + Hooks                          |
| 状态            | Zustand                    | 5.x                                 | 轻量全局状态                              |
| 采集            | Playwright                 | 1.65.x                              | Chromium / 系统 Chrome / Edge，复用登录态 |
| 存储            | `node:sqlite`（Node 内置） | SQLite 3.53                         | 单文件、零原生依赖、免编译                |
| 实时通信        | ws                         | 8.x                                 | 主进程 → 渲染进程 / overlay 页            |
| HTTP（overlay） | Express                    | 4.x                                 | 仅提供本地 overlay 静态页与数据接口       |
| 图表            | ECharts                    | 5.x                                 | 按场次序列、缩放、标记点                  |
| 打包            | electron-builder           | 26.x                                | NSIS 安装包 + 自动更新                    |
| 包管理          | npm                        | 11.x                                | `package-lock.json` 入库                  |
| 代码规范        | ESLint + Prettier          | 最新稳定                            | 提交前检查                                |

### 2.1 关键约束

- **单语言 TypeScript**：采集、后端、前端同一语言，降低切换成本。
- **Playwright 运行在主进程**：不要把浏览器实例放到渲染进程。
- **SQLite 只在主进程访问**：渲染进程通过 IPC 获取数据。
- **overlay 页面的数据通过本地 WS/HTTP 提供**，不直接读 DB。
- **存储使用 Node 内置 `node:sqlite`**：Electron 45 内置 Node 24，自带 SQLite，避免 better-sqlite3 的原生编译与 ABI 重建（本机无 Python/VS 构建链）。

### 2.2 备选方案（不采用，仅记录）

| 方案                        | 不采用原因                                        |
| --------------------------- | ------------------------------------------------- |
| Python FastAPI + pywebview  | 双语言维护，打包体积与更新链路更复杂              |
| Tauri                       | Playwright 集成与透明悬浮窗生态不如 Electron 成熟 |
| 游戏内存读取（REFramework） | 真实时但有封号风险，且仅 PC，违背合规要求         |

---

## 3. 系统架构

```
┌───────────────────────────── Electron 主进程 ─────────────────────────────┐
│                                                                            │
│  AuthManager ──> Collector(Polling) ──> Parser ──> Repository ──> SQLite   │
│        │                │                              │                    │
│        │                └──> RateLimiter/Backoff       │                    │
│        │                                               │                    │
│        └── session.json + chrome-profile               │                    │
│                                                        ▼                    │
│                                              RealtimeHub (ws)               │
│                                                        │                    │
│  OverlayServer (Express) <─────────────────────────────┘                    │
└───────────────────────────────┬────────────────────────────────────────────┘
                                │ IPC / WebSocket
        ┌───────────────────────┴───────────────────────┐
        ▼                                               ▼
  主窗口 React 渲染进程                          图表弹窗 React 渲染进程
  (概览/记录/统计/设置等)                        (Mini / Pro 最近 20 场)
        │                                               │
        └───────────────────────┬───────────────────────┘
                                ▼
                         OBS 浏览器源 (/overlay)
```

### 3.1 数据流

1. 用户点击登录 → 启动普通 Chrome（独立 `chrome-profile`）→ 用户手动完成 CAPCOM ID 登录/人机验证 → CDP 读取 Cookie 并保存 `session.json`
2. Collector 用 Electron `session.fetch`（静默、无可见窗口）定时拉取 `battlelog/rank` 页
3. Parser 解析 `__NEXT_DATA__` → 标准化 Match
4. Repository 以 `replay_id` 去重入库
5. 计算增量（本场 ±LP/MR、会话累计）
6. RealtimeHub 广播 `match:new` / `rating:update` / `session:update`
7. 渲染进程与 overlay 页更新 UI

---

## 4. 目录结构

```
SF6scorer/
├─ electron/                    # 主进程
│  ├─ main.ts                   # 应用入口、窗口管理
│  ├─ preload.ts                # IPC 白名单桥
│  ├─ ipc/                      # IPC handler
│  ├─ collector/
│  │  ├─ auth.ts                # 普通 Chrome + CDP 登录 / session.json
│  │  ├─ electron-fetcher.ts    # Electron session.fetch 静默抓取
│  │  ├─ fetcher.ts             # MatchSource 接口
│  │  ├─ poller.ts              # 轮询调度、会话识别
│  │  ├─ parser.ts              # __NEXT_DATA__ 解析
│  │  └─ rate-limiter.ts
│  ├─ db/
│  │  ├─ schema.sql
│  │  ├─ migrate.ts
│  │  └─ repository.ts
│  ├─ server/
│  │  ├─ overlay-server.ts
│  │  └─ realtime-hub.ts
│  └─ windows/
├─ src/                         # 渲染进程
│  ├─ main.tsx                  # 主窗口入口
│  ├─ App.tsx                   # 主窗口壳与页面导航
│  ├─ chart.tsx                 # 图表弹窗入口
│  ├─ ChartApp.tsx              # 图表弹窗 Mini/Pro
│  ├─ pages/                    # 概览/对战/角色/赛季/导出/诊断/设置
│  ├─ views/                    # 图表专用 MiniView / ProView
│  ├─ lib/                      # 实时连接、分数增量
│  ├─ components/
│  ├─ store/                    # zustand
│  └─ styles.css
├─ shared/
│  ├─ types.ts                  # 主/渲染共享类型与协议
│  └─ env.d.ts                  # ?raw 与 vite 类型声明
├─ spike/                       # 可行性验证脚本（不进主程序）
│  ├─ m0.ts                     # 登录/抓取/解析 + self-test + probe
│  ├─ discover.ts               # 探查公开排行页结构
│  ├─ db-selftest.ts            # Repository 冒烟测试
│  ├─ m1-selftest.ts            # SyncService 去重/会话测试
│  ├─ m1-fetch-check.ts         # BattleLogSource 抓取路径检查
│  └─ out/                      # 原始抓取产物（gitignore）
├─ resources/                   # 图标、静态资源
├─ docs/
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ package.json
├─ package-lock.json
├─ tsconfig.json
├─ .eslintrc.cjs
├─ .prettierrc
└─ DEVELOPMENT.md
```

---

## 5. 数据模型

### 5.1 SQLite Schema

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS players (
  short_id      TEXT PRIMARY KEY,          -- Buckler 唯一 ID，不可改
  cfn           TEXT,
  display_name  TEXT,
  is_self       INTEGER NOT NULL DEFAULT 0,
  last_synced   INTEGER,                    -- epoch ms
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  replay_id     TEXT PRIMARY KEY,
  short_id      TEXT NOT NULL REFERENCES players(short_id),
  opponent_id   TEXT,
  my_char       TEXT,
  opp_char      TEXT,
  result        TEXT NOT NULL CHECK (result IN ('win','loss','draw')),
  my_mr         INTEGER,
  opp_mr        INTEGER,
  my_lp         INTEGER,
  played_at     INTEGER NOT NULL,
  season        TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matches_short_time
  ON matches(short_id, played_at DESC);

CREATE TABLE IF NOT EXISTS rating_points (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  short_id      TEXT NOT NULL REFERENCES players(short_id),
  character     TEXT,
  kind          TEXT NOT NULL CHECK (kind IN ('LP','MR')),
  value         INTEGER NOT NULL,
  source        TEXT NOT NULL,              -- battlelog | snapshot | manual
  estimated     INTEGER NOT NULL DEFAULT 0,
  observed_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rating_short_kind_time
  ON rating_points(short_id, kind, observed_at);

CREATE TABLE IF NOT EXISTS sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  short_id      TEXT NOT NULL REFERENCES players(short_id),
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  start_rating  INTEGER,
  end_rating    INTEGER,
  start_lp      INTEGER,
  end_lp        INTEGER
);

CREATE TABLE IF NOT EXISTS session_marks (
  short_id      TEXT PRIMARY KEY REFERENCES players(short_id),
  started_at    INTEGER NOT NULL,
  start_mr      INTEGER,
  start_lp      INTEGER,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL
);
```

### 5.2 去重与会话规则

- 主键：`replay_id`，`INSERT OR IGNORE`。
- 会话边界：相邻对局时间差 ≥ 3 小时 → 新 session。
- 手动会话：用户在 UI 点击刷新时写入 `session_marks`，记录点击时的最新 MR/LP 基线；统计 `played_at >= started_at` 的对局，并优先于自动会话展示。
- 对战记录中的 `my_mr` / `my_lp` 是**比赛开始前分数**，不是赛后分数；历史评分点仍按该值入库。
- 当前分数从个人资料页 `character_league_infos[*].league_info` 获取，写入 `source = 'snapshot'`；未变化且最新比赛后已有快照时不重复写入，新比赛后同值也会补快照。
- 增量计算：同角色按时间排序后，用“下一场赛前分数 - 本场赛前分数”作为本场增减；最新一场使用“当前快照 - 最新赛前分数”。缺失时用 Elo 估算并置 `estimated = 1`。
- 最新自动会话与手动会话的结束分数均优先使用当前快照，避免会话累计少算最新一场。
- LP 与 MR 独立，不做互相换算。

---

## 6. 采集层规范

### 6.1 目标接口

```
登录：https://www.streetfighter.com/6/buckler/  (CAPCOM ID)
资料：https://www.streetfighter.com/6/buckler/profile/{short_id}
战绩：https://www.streetfighter.com/6/buckler/profile/{short_id}/battlelog/rank?page={n}
```

解析页面内 `__NEXT_DATA__` / Next.js data route JSON，**不做 DOM 文本抓取**。

### 6.2 必取字段

| 字段      | 来源                                 |
| --------- | ------------------------------------ |
| replay_id | `replay_id`                          |
| 我方 MR   | `player*_info.master_rating`         |
| 角色      | `player*_info.character_name`        |
| 胜负      | `round_results` 中 `0` 计数 ≥ 2 判负 |
| 时间戳    | 对局时间字段                         |
| LP        | 页面提供则取，否则用 MR              |
| 当前 MR   | 资料页 `character_league_infos[*].league_info.master_rating` |
| 当前 LP   | 资料页 `character_league_infos[*].league_info.league_point`  |

### 6.3 运行规则

- 轮询间隔：默认 20s，可在设置中 15–60s 调整。
- 速率限制：单账号串行，令牌桶；429/异常指数退避（上限 5 分钟）。
- 全部字段按 nullable 处理，解析失败单条跳过并记录。
- `buildId` 变更检测：解析失败率超阈值 → 告警「数据源可能改版」。
- 登录失效检测：HTTP 状态 + 内嵌 status 双校验。
- 登录态：`app.getPath('userData')/session.json`（Cookie + 真实 UA/UA-CH + 语言）；浏览器配置在 `userData/chrome-profile`，权限仅当前用户。
- **登录方式**：使用**普通 Chrome 窗口**打开 Buckler，用户手动完成 CAPCOM ID 登录与 Cloudflare 人机验证；验证完成后应用通过 CDP 读取登录态。避免 Playwright 在验证前注入自动化指纹。
- **Chrome 136+ 限制**：默认配置目录会忽略 `--remote-debugging-port` / `--remote-debugging-pipe`，必须使用非默认 `--user-data-dir`；非默认目录使用不同加密密钥，复制日常 profile 也无法恢复登录态。因此应用使用独立 `chrome-profile`。
- **同步方式**：Electron `session.fromPartition('persist:sf6-buckler').fetch()` 使用 Chromium 网络栈静默请求，不打开任何可见窗口；Cookie/UA/UA-CH 与登录时保持一致。

### 6.4 合规

- 仅访问用户本人可访问的公开页面。
- 不绕过鉴权、不伪造请求、不高频抓取。
- 首次使用需用户确认「非官方工具 / 风险提示」。

### 6.5 采集实现说明

- 登录：`loginWithChrome()` 启动普通 Chrome（独立 profile + 动态调试端口），等待用户手动登录；通过 `__NEXT_DATA__` 的 `loginUser.flg`、退出文案与 `/profile/{id}/` 链接识别登录成功，随后通过 `connectOverCDP` 读取 Cookie、UA 与 UA-CH，保存 `session.json` 并关闭 Chrome。
- 采集：`ElectronBucklerSource` 把 `session.json` 的 Cookie 导入 Electron session，使用 `session.fetch` 打开 `battlelog/rank`，解析 `__NEXT_DATA__`；全程无可见窗口。
- 分页：首次同步按页抓取全部可查询场次（读取 `total_page`，遇到空页/重复页停止，上限 200 页），完成后记录 `backfill:<shortId>`；后续轮询从第 1 页增量抓取，遇到已知场次即停止。批量回填只推送最新一条评分事件，避免 UI 抖动。对局时间取自 `uploaded_at`（Unix 秒）；昵称取自 `fighter_banner_info.personal_info.fighter_id`，仅在 `display_name` 为空时自动补全；单个账号抓取失败只发 `sync:warning`，不阻塞其他账号。
- 同步：`SyncService` 每 20s 拉取一次，按 `replay_id` 去重；新对局写入 `matches` 与 `rating_points`，并重建 `sessions`。
- 当前分数：每轮同步比赛后额外抓取资料页，解析 `character_league_infos` 的 MR/LP，写入 `rating_points(source='snapshot')`；抓取失败只发一次 `当前分数获取失败` 告警，不阻塞对局同步。
- 推送：新对局/评分/会话通过 `RealtimeHub` 广播；同步状态同时写入快照。
- 账号：`auth:login` 异步执行登录并在成功后自动启动同步；`players:add` 可附带昵称，`players:remove` 删除账号及其对局/评分/会话数据，增删后自动重启同步。
- 失败处理：403/401/登录跳转/Cloudflare 挑战页会返回明确错误，提示重新登录；连续 3 次 0 对局触发 `sync:warning`。

---

## 7. 实时通信协议

### 7.1 IPC（渲染进程 ↔ 主进程）

| 通道                            | 方向   | 载荷                          |
| ------------------------------- | ------ | ----------------------------- |
| `auth:login`                    | invoke | `{ shortId }`                 |
| `auth:status`                   | invoke | → `{ loggedIn, shortId? }`    |
| `players:list`                  | invoke | → `Player[]`                  |
| `players:add`                   | invoke | `{ cfn, displayName? }`       |
| `players:remove`                | invoke | `shortId`                     |
| `matches:list`                  | invoke | `MatchQuery`                  |
| `matches:page`                  | invoke | `MatchQuery` → `MatchPage`    |
| `ratings:series`                | invoke | `{ shortId, kind, from, to }` |
| `stats:characters`              | invoke | `shortId` → `CharacterStat[]` |
| `stats:seasons`                 | invoke | `shortId` → `SeasonStat[]`    |
| `diagnostics:get`               | invoke | `shortId` → `Diagnostics`     |
| `session:refresh`               | invoke | `shortId` → `SessionSummary`  |
| `settings:get` / `settings:set` | invoke | `{ key, value }`              |
| `export:matchesCsv`             | invoke | `shortId` → `ExportResult`    |
| `export:dataJson`               | invoke | `shortId` → `ExportResult`    |
| `export:database`               | invoke | → `ExportResult`              |
| `active:get` / `active:set`     | invoke | → `shortId` / `shortId`       |
| `active:changed`                | event  | `shortId`                     |
| `chart:open` / `chart:close`    | send   | —                             |
| `chart:setMode`                 | send   | `mini \| pro`                 |
| `chart:setAlwaysOnTop`          | send   | `boolean`                     |
| `chart:setOpacity`              | send   | `number`                      |

### 7.2 WebSocket 事件（主 → 渲染 / overlay）

```ts
type ServerEvent =
  | { type: 'match:new'; payload: Match }
  | { type: 'rating:update'; payload: RatingPoint }
  | { type: 'session:update'; payload: SessionSummary }
  | {
      type: 'sync:status'
      payload: { state: 'idle' | 'syncing' | 'error'; at: number; message?: string }
    }
  | { type: 'snapshot'; payload: AppSnapshot }
```

连接建立时先推送一次 `snapshot` 做全量对齐，之后增量推送。断线重连 1s/2s/4s/… 上限 30s。

---

## 8. UI 规格

### 8.1 主窗口

- 启动只打开主窗口（标准不透明窗口，约 1080×720），关闭主窗口退出应用
- 顶栏：当前账号选择、同步状态、打开图表弹窗
- 页面顺序：概览、对战记录、对战详情、角色统计、赛季报告、数据导出/备份、数据同步、设置（最后一项）
- 概览：当前 MR/LP、本会话净上分、胜率、同步状态、最近对局
- 对战记录：按 MR/LP、结果、角色、日期筛选并分页；点击进入对战详情
- 对战详情：双方角色、赛前分数、单场变化、对手分数、时间/赛季/replay_id
- 角色统计：各角色对局数、胜负、胜率、当前 MR/LP、最后对局
- 赛季报告：按 season 或月份汇总对局、胜率、MR/LP 范围
- 数据导出/备份：CSV、完整 JSON、SQLite 数据库备份
- 数据同步：登录状态、数据量、最近同步/对局、状态历史
- 设置：账号增删、登录、同步间隔、图表默认模式/置顶/透明度、OBS 地址

### 8.2 图表弹窗

- 与主窗口独立，按需打开；关闭图表窗口仅隐藏，不影响主窗口
- Mini：当前 LP/MR、本会话累计 ±、胜负、胜率；MR/LP 手动切换并记忆在 `settings.miniKind`；刷新按钮重置手动会话
- Pro：顶部大字本次会话净上分，ECharts 折线仅展示**最近 20 场比赛**；支持 MR/LP 切换、角色过滤、缩放/拖拽
- Pro 横轴为场次，日期标签只在每天首场显示一次；默认选中最近使用的角色；全部角色时每个角色一条折线
- 图表图标位于对应赛后数据点（同角色下一场赛前分数或当前快照），图标显示对手角色与单场 ± 分；胜绿、负红、平黄
- 同步/刷新导致数据更新时保留当前 dataZoom 缩放范围
- 图表窗口不包含账号切换、登录/同步控制、设置或对战列表

### 8.3 OBS

- 方式 A（推荐）：`http://127.0.0.1:{port}/overlay?player={shortId}&mode=mini`
- 方式 B：窗口捕获透明 Electron 窗
- 背景透明度 0–100% 可调

### 8.4 窗口能力

- 主窗口：标准边框、不透明，启动默认打开
- 图表窗口：无边框、透明、可拖拽；Mini 默认置顶，Pro 默认不置顶；位置/尺寸/置顶/透明度可记忆
- 主窗口与图表窗口共享当前账号；主窗口切换账号后图表自动跟随
- 单实例锁；关闭主窗口退出，关闭图表窗口仅隐藏

---

## 9. 开发流程与里程碑

| 阶段           | 目标               | 交付物                                      | 验收标准                                   |
| -------------- | ------------------ | ------------------------------------------- | ------------------------------------------ |
| M0 可行性      | 证明数据可得       | Playwright 登录 + 抓取一页 battlelog 并解析 | 能稳定解析出 ≥1 场对局的 replay_id/MR/胜负 |
| M1 采集存储    | 轮询 + 去重 + 入库 | Collector + Repository + schema             | 重复轮询不产生重复记录；会话正确切分       |
| M2 Mini 面板   | 实时悬浮窗         | 主进程 WS + Mini UI                         | 新对局 30s 内 UI 更新，数字动画正常        |
| M3 Pro 趋势图  | 趋势可视化         | ECharts Pro 面板                            | 图表与 DB 数据一致，过滤/缩放可用          |
| M4 OBS overlay | 直播叠加           | overlay 页 + 透明置顶                       | OBS 浏览器源可透明叠加，无闪烁             |
| M5 多账号+打包 | 可分发             | 多账号 UI + exe + 自动更新                  | 安装包在干净 Win10/11 可运行               |
| M6 加固        | 稳定性             | 限速/告警/恢复                              | 断网、登出、改版模拟均不崩溃               |

### 9.1 每阶段工作流

1. 在 `docs/` 更新对应设计（如需要）
2. 编码 → 本地运行 → 手动验证
3. `npm run lint` + `npm run typecheck` + `npm run build` 通过
4. 提交（分阶段小提交，按需）
5. 更新本文件「进度」章节

### 9.2 脚本约定（package.json）

```jsonc
{
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --ext .ts,.tsx",
    "format": "prettier --write .",
    "dist": "electron-vite build && electron-builder --config.electronDist=node_modules/electron/dist",
    "spike:m0": "tsx spike/m0.ts",
    "spike:selftest": "tsx spike/m0.ts --self-test",
    "spike:dbtest": "tsx spike/db-selftest.ts",
    "spike:m1test": "tsx spike/m1-selftest.ts",
    "spike:uitest": "tsx spike/ui-selftest.ts",
    "spike:netcheck": "electron spike/electron-fetch-check.cjs"
  }
}
```

### 9.3 M0 打样使用说明

```bash
# 1) 解析器 / 数据库 / 同步逻辑自检（无需网络）
npm run spike:selftest
npm run spike:dbtest
npm run spike:m1test
npm run spike:uitest   # 校验主窗口页面、图表弹窗、最近 20 场、账号联动与 overlay

# 2) 环境连通性自检（Electron 网络栈，无窗口）
npm run spike:netcheck

# 3) 登录并抓取真实战绩（首次会打开普通 Chrome 等待手动登录）
npm run spike:m0 -- --short-id <Buckler_ID> --channel chrome

# 4) 抓取并导出原始数据，便于排查页面结构
npm run spike:m0 -- --short-id <Buckler_ID> --channel chrome --dump
```

- `--channel chrome|msedge`：使用系统中的普通浏览器；默认 `chrome`。
- 登录：`spike:m0` 会先调用 `loginWithChrome()`，打开独立 `chrome-profile`；完成 CAPCOM ID 登录与人机验证后，保存 `spike/out/session.json` 并关闭 Chrome。
- 抓取：登录后使用 `chromium.launchPersistentContext(profileDir)` 复用同一配置目录；`--headless` 仅在已登录时可用。
- 登录态默认保存于 `spike/out/session.json`，浏览器配置在 `spike/out/chrome-profile`。
- 若解析为 0 场：查看 `spike/out/page.html` 与 `spike/out/candidate-*/payload.json`，据此调整 `electron/collector/parser.ts`。

---

## 10. 编码规范

- TypeScript `strict: true`，禁用 `any`（必要时 `unknown` + 收窄）
- 共享类型集中在 `shared/types.ts`，主/渲染不得重复定义
- IPC/WS 通道名用常量，禁止裸字符串
- 主进程不做 UI 逻辑；渲染进程不直接访问 Node/DB
- 所有外部数据视为不可信，先校验再入库
- 提交信息：`<type>(<scope>): <subject>`（feat/fix/chore/docs）
- 不提交 `session.json`、`chrome-profile/`、`*.db`、密钥、`node_modules`

---

## 11. 风险登记

| 风险                                  | 影响 | 对策                                                                       |
| ------------------------------------- | ---- | -------------------------------------------------------------------------- |
| 违反 Capcom ToS / 封号                | 高   | 低频只读、风险提示、不绕过鉴权                                             |
| CloudFront 反自动化（403）            | 高   | 登录用普通 Chrome + 手动人机验证；同步用 Electron 网络栈；不再伪造 UA/时区 |
| Chrome 136+ 禁止默认 profile 远程调试 | 高   | 使用独立 `chrome-profile`；不读取/复制日常 Chrome 配置                     |
| Buckler 改版 / buildId 变更           | 高   | 解析层隔离、schema 校验、失败告警、快速热修                                |
| 数据更新延迟                          | 中   | 定位准实时、UI 标注时间                                                    |
| 速率限制 / 风控                       | 中   | 令牌桶、串行、指数退避；分页回填页间延迟 600ms                             |
| 全量回填请求过多                      | 中   | 仅首次/缺失标记时回填，上限 200 页；后续只拉第 1 页及必要增量页            |
| 赛季重置 / 数据缺失                   | 中   | 记录 season、增量标记 estimated                                            |
| 多账号并发                            | 低   | 队列隔离 + 全局并发上限                                                    |

---

## 12. 验收标准（v1.0）

- [ ] 首次登录流程可用，登录态可持久化
- [ ] 自己账号与任意 CFN ID 均可追踪
- [ ] 新对局 30s 内反映到 Mini 与 Pro
- [ ] 趋势图数据与 SQLite 一致，无重复
- [ ] OBS 浏览器源可透明叠加
- [ ] 打包后干净 Windows 环境可运行
- [x] `lint` / `typecheck` 无错误

---

## 13. 进度

| 日期       | 阶段           | 说明                                                                                                                                                                                                           |
| ---------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-08 | 文档           | 技术栈与开发流程锁定                                                                                                                                                                                           |
| 2026-11-08 | M0 打样        | 解析器自检通过；Playwright + 系统 Chrome 访问 Buckler 返回 200；登录/抓取/导出脚本就绪。真实战绩解析待使用本人账号执行                                                                                         |
| 2026-11-08 | 工程骨架       | Electron 45 + Vite 8 + React 19 + node:sqlite 骨架可构建、类型检查/lint 通过、应用可启动并建库                                                                                                                 |
| 2026-11-08 | M1 采集存储    | 登录/抓取/同步接入主进程；去重、评分点、会话切分完成；`spike:m1test` 通过；overlay 服务 health/overlay 返回 200；真实登录抓取待账号验证                                                                        |
| 2026-11-08 | M2 Mini 面板   | zustand store + WS 增量更新；MR→LP 自动切换、会话 ±、胜率、数字动画、账号切换、登录/开始/停止                                                                                                                  |
| 2026-11-08 | M3 Pro 趋势图  | ECharts 折线（按场次/缩放/角色过滤）、当前/最高/最低统计、最近对局、轮询间隔与窗口透明度设置                                                                                                                   |
| 2026-11-08 | M4 OBS overlay | `/overlay?player=&mode=&opacity=`，快照+增量渲染、断线 2s 重连、透明卡片                                                                                                                                       |
| 2026-11-08 | M5 多账号+打包 | 多账号仪表盘与切换；`electron-builder --dir` 与 NSIS 均构建成功（`dist/SF6-Scorer-0.1.0-x64.exe`），`win-unpacked` 启动后 `/health` 返回 200                                                                   |
| 2026-11-08 | M6 加固        | 连续 3 次零对局触发 `sync:warning`；限速/退避沿用；`spike:uitest` 校验 Mini/Pro 尺寸切换与 overlay                                                                                                             |
| 2026-11-08 | 登录/采集重构  | 登录改为普通 Chrome（独立 profile + CDP）手动完成人机验证；保存 `session.json`；同步改为 Electron `session.fetch` 静默抓取，无可见 Chrome 窗口；`spike:netcheck` 返回 200；真实账号登录与 battlelog 抓取待验证 |
| 2026-11-08 | 全量场次/图表  | 首次同步分页回填全部可查询场次，后续增量；Pro 横轴按场次，日期标签每天一次；`spike:m1test` 覆盖回填批量事件                                                                                                    |
| 2026-11-08 | 账号标签       | 账号显示昵称/shortId；添加时可选昵称；Pro 标签右上角删除并级联清理；采集自动补全昵称；`spike:uitest` 使用临时 userData 验证增删标签                                                                          |
| 2026-11-08 | 手动会话/图标  | Mini MR/LP 手动切换与刷新；Pro 大字本次会话净上分；32 个角色图标与单场 ± badge；`session_marks` 手动会话基线；`spike:uitest` 覆盖 LP、图标、刷新  |
| 2026-11-09 | 分数系统修正   | 对战记录明确为赛前分数；资料页当前 MR/LP 写入 snapshot；单场增减归属上一场，最新场用当前快照；最新自动/手动会话使用当前分数；图表图标后移至赛后数据点并显示单场 ±；同步刷新保留图表缩放；自测覆盖当前快照、UI badge 与缩放保持 |
| 2026-11-09 | 主窗口/图表拆分 | 启动只开主窗口；图表改为独立 Mini/Pro 弹窗，Pro 固定最近 20 场；主窗口新增概览、对战记录/详情、角色统计、赛季报告、导出/备份、同步诊断、设置；账号在两窗联动；`spike:uitest` 覆盖页面、双窗口、最近 20 场与缩放保持 |

---

## 14. 待决事项

- [ ] 是否需要开机自启 / 托盘常驻
- [ ] 是否接入自动更新服务器（GitHub Releases 或自建）
- [ ] 语言：仅中文，还是中英双语
- [ ] 是否需要分享图 / 赛季长图

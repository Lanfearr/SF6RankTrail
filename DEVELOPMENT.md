# SF6 Scorer 开发文档

> 实时显示《街头霸王6》LP/MR 分数变化趋势的桌面应用
> 版本：v0.1（技术栈已锁定）
> 状态：开发文档

---

## 1. 项目概述

### 1.1 目标

做一个 Windows 桌面应用，准实时追踪《街霸6》玩家（自己或任意 CFN ID）的排位分数变化，并提供：

- Mini 悬浮窗：当前 LP/MR、本场胜负、本会话累计变化、胜率
- Pro 面板：LP/MR 时间序列趋势图、按角色过滤、对局列表联动
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

| 层 | 选型 | 版本基线 | 说明 |
|---|---|---|---|
| 运行时 | Node.js | 26.x（本机）/ 24.x（Electron 内置） | 主进程与构建 |
| 语言 | TypeScript | 5.9.x | 全栈统一，`strict: true` |
| 桌面壳 | Electron | 45.x | 悬浮窗/透明/置顶/OBS |
| 构建 | Vite | 8.x | 渲染进程 |
| Electron 集成 | electron-vite | 6.x | main/preload/renderer 三端构建 |
| UI | React | 19.x | 函数组件 + Hooks |
| 状态 | Zustand | 5.x | 轻量全局状态 |
| 采集 | Playwright | 1.65.x | Chromium / 系统 Chrome / Edge，复用登录态 |
| 存储 | `node:sqlite`（Node 内置） | SQLite 3.53 | 单文件、零原生依赖、免编译 |
| 实时通信 | ws | 8.x | 主进程 → 渲染进程 / overlay 页 |
| HTTP（overlay） | Express | 4.x | 仅提供本地 overlay 静态页与数据接口 |
| 图表 | ECharts | 5.x | 时间序列、缩放、标记点 |
| 打包 | electron-builder | 26.x | NSIS 安装包 + 自动更新 |
| 包管理 | npm | 11.x | `package-lock.json` 入库 |
| 代码规范 | ESLint + Prettier | 最新稳定 | 提交前检查 |

### 2.1 关键约束

- **单语言 TypeScript**：采集、后端、前端同一语言，降低切换成本。
- **Playwright 运行在主进程**：不要把浏览器实例放到渲染进程。
- **SQLite 只在主进程访问**：渲染进程通过 IPC 获取数据。
- **overlay 页面的数据通过本地 WS/HTTP 提供**，不直接读 DB。
- **存储使用 Node 内置 `node:sqlite`**：Electron 45 内置 Node 24，自带 SQLite，避免 better-sqlite3 的原生编译与 ABI 重建（本机无 Python/VS 构建链）。

### 2.2 备选方案（不采用，仅记录）

| 方案 | 不采用原因 |
|---|---|
| Python FastAPI + pywebview | 双语言维护，打包体积与更新链路更复杂 |
| Tauri | Playwright 集成与透明悬浮窗生态不如 Electron 成熟 |
| 游戏内存读取（REFramework） | 真实时但有封号风险，且仅 PC，违背合规要求 |

---

## 3. 系统架构

```
┌───────────────────────────── Electron 主进程 ─────────────────────────────┐
│                                                                            │
│  AuthManager ──> Collector(Polling) ──> Parser ──> Repository ──> SQLite   │
│        │                │                              │                    │
│        │                └──> RateLimiter/Backoff       │                    │
│        │                                               │                    │
│        └── storageState(cookies)                       │                    │
│                                                        ▼                    │
│                                              RealtimeHub (ws)               │
│                                                        │                    │
│  OverlayServer (Express) <─────────────────────────────┘                    │
└───────────────────────────────┬────────────────────────────────────────────┘
                                │ IPC / WebSocket
        ┌───────────────────────┴───────────────────────┐
        ▼                                               ▼
  React 渲染进程 (Mini / Pro / Settings)          OBS 浏览器源 (/overlay)
```

### 3.1 数据流

1. 用户登录 → AuthManager 保存 `storageState`
2. Collector 定时拉取 `battlelog/rank` 页
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
│  │  ├─ auth.ts                # Playwright 登录 / storageState
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
│  ├─ main.tsx
│  ├─ App.tsx
│  ├─ views/
│  │  ├─ Mini/
│  │  ├─ Pro/
│  │  └─ Settings/
│  ├─ components/
│  ├─ store/                    # zustand
│  ├─ overlay/                  # OBS 页面
│  └─ styles/
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
  end_rating    INTEGER
);

CREATE TABLE IF NOT EXISTS settings (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL
);
```

### 5.2 去重与会话规则

- 主键：`replay_id`，`INSERT OR IGNORE`。
- 会话边界：相邻对局时间差 ≥ 3 小时 → 新 session。
- 增量计算：相邻 `rating_points` 差值；缺失时用 Elo 估算并置 `estimated = 1`。
- LP 与 MR 独立，不做互相换算。

---

## 6. 采集层规范

### 6.1 目标接口

```
登录：https://www.streetfighter.com/6/buckler/  (CAPCOM ID)
战绩：https://www.streetfighter.com/6/buckler/profile/{short_id}/battlelog/rank?page={n}
```

解析页面内 `__NEXT_DATA__` / Next.js data route JSON，**不做 DOM 文本抓取**。

### 6.2 必取字段

| 字段 | 来源 |
|---|---|
| replay_id | `replay_id` |
| 我方 MR | `player*_info.master_rating` |
| 角色 | `player*_info.character_name` |
| 胜负 | `round_results` 中 `0` 计数 ≥ 2 判负 |
| 时间戳 | 对局时间字段 |
| LP | 页面提供则取，否则用 MR |

### 6.3 运行规则

- 轮询间隔：默认 20s，可在设置中 15–60s 调整。
- 速率限制：单账号串行，令牌桶；429/异常指数退避（上限 5 分钟）。
- 全部字段按 nullable 处理，解析失败单条跳过并记录。
- `buildId` 变更检测：解析失败率超阈值 → 告警「数据源可能改版」。
- 登录失效检测：HTTP 状态 + 内嵌 status 双校验。
- 存储 `storageState` 到 `app.getPath('userData')/storage.json`，权限仅当前用户。
- **反自动化检测**：Buckler 经 CloudFront，纯 headless 会返回 403。必须使用真实 UA、`--disable-blink-features=AutomationControlled`、移除 `navigator.webdriver`，并优先用系统 Chrome/Edge（`channel: 'chrome' | 'msedge'`）。已实测：系统 Chrome headless 返回 200。

### 6.4 合规

- 仅访问用户本人可访问的公开页面。
- 不绕过鉴权、不伪造请求、不高频抓取。
- 首次使用需用户确认「非官方工具 / 风险提示」。

### 6.5 M1 实现说明

- 登录：`loginInteractively()` 打开系统 Chrome/Edge，轮询页面内 `/profile/{id}/` 链接与 logout 文案，识别成功后保存 `storageState`。
- 采集：`BattleLogSource` 复用同一浏览器上下文，打开 `battlelog/rank`，解析 `__NEXT_DATA__`。
- 同步：`SyncService` 每 20s 拉取一次，按 `replay_id` 去重；新对局写入 `matches` 与 `rating_points`，并重建 `sessions`。
- 推送：新对局/评分/会话通过 `RealtimeHub` 广播；同步状态同时写入快照。
- 账号：`auth:login` 异步执行登录并在成功后自动启动同步；`players:add` 增删账号后自动重启同步。

---

## 7. 实时通信协议

### 7.1 IPC（渲染进程 ↔ 主进程）

| 通道 | 方向 | 载荷 |
|---|---|---|
| `auth:login` | invoke | `{ shortId }` |
| `auth:status` | invoke | → `{ loggedIn, shortId? }` |
| `players:list` | invoke | → `Player[]` |
| `players:add` | invoke | `{ cfn }` |
| `matches:list` | invoke | `{ shortId, limit, offset }` |
| `ratings:series` | invoke | `{ shortId, kind, from, to }` |
| `settings:get` / `settings:set` | invoke | `{ key, value }` |
| `window:setAlwaysOnTop` | send | `boolean` |
| `window:setOpacity` | send | `number` |

### 7.2 WebSocket 事件（主 → 渲染 / overlay）

```ts
type ServerEvent =
  | { type: 'match:new';       payload: Match }
  | { type: 'rating:update';   payload: RatingPoint }
  | { type: 'session:update';  payload: SessionSummary }
  | { type: 'sync:status';     payload: { state: 'idle'|'syncing'|'error'; at: number; message?: string } }
  | { type: 'snapshot';        payload: AppSnapshot };
```

连接建立时先推送一次 `snapshot` 做全量对齐，之后增量推送。断线重连 1s/2s/4s/… 上限 30s。

---

## 8. UI 规格

### 8.1 Mini 模式

- 显示：当前 LP/MR、本场 ±、本会话累计 ±、胜负、胜率
- 角色为 Master 显示 MR，否则显示 LP（自动切换）
- 数字滚动动画；数据时间角标
- 记忆位置/尺寸/透明度

### 8.2 Pro 模式

- ECharts 折线：LP/MR 双序列或切换
- 支持缩放、框选、拖拽平移、回到总览
- 按角色过滤；对局列表与可见时间范围联动
- 胜率统计

### 8.3 OBS

- 方式 A（推荐）：`http://127.0.0.1:{port}/overlay?player={shortId}&mode=mini`
- 方式 B：窗口捕获透明 Electron 窗
- 背景透明度 0–100% 可调

### 8.4 窗口能力

- 无边框、透明、可拖拽、置顶开关
- 单实例锁；关闭到托盘（可选）

---

## 9. 开发流程与里程碑

| 阶段 | 目标 | 交付物 | 验收标准 |
|---|---|---|---|
| M0 可行性 | 证明数据可得 | Playwright 登录 + 抓取一页 battlelog 并解析 | 能稳定解析出 ≥1 场对局的 replay_id/MR/胜负 |
| M1 采集存储 | 轮询 + 去重 + 入库 | Collector + Repository + schema | 重复轮询不产生重复记录；会话正确切分 |
| M2 Mini 面板 | 实时悬浮窗 | 主进程 WS + Mini UI | 新对局 30s 内 UI 更新，数字动画正常 |
| M3 Pro 趋势图 | 趋势可视化 | ECharts Pro 面板 | 图表与 DB 数据一致，过滤/缩放可用 |
| M4 OBS overlay | 直播叠加 | overlay 页 + 透明置顶 | OBS 浏览器源可透明叠加，无闪烁 |
| M5 多账号+打包 | 可分发 | 多账号 UI + exe + 自动更新 | 安装包在干净 Win10/11 可运行 |
| M6 加固 | 稳定性 | 限速/告警/恢复 | 断网、登出、改版模拟均不崩溃 |

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
    "dist": "electron-vite build && electron-builder",
    "spike:m0": "tsx spike/m0.ts",
    "spike:selftest": "tsx spike/m0.ts --self-test",
    "spike:dbtest": "tsx spike/db-selftest.ts",
    "spike:m1test": "tsx spike/m1-selftest.ts"
  }
}
```

### 9.3 M0 打样使用说明

```bash
# 1) 解析器 / 数据库 / 同步逻辑自检（无需网络）
npm run spike:selftest
npm run spike:dbtest
npm run spike:m1test

# 2) 环境连通性自检（使用系统 Chrome）
npm run spike:m0 -- --probe --headless --channel chrome

# 3) 登录并抓取真实战绩（首次会打开浏览器等待手动登录）
npm run spike:m0 -- --short-id <Buckler_ID> --channel chrome

# 4) 抓取并导出原始数据，便于排查页面结构
npm run spike:m0 -- --short-id <Buckler_ID> --channel chrome --dump
```

- `--channel chrome|msedge`：使用系统浏览器，规避 Playwright 浏览器下载失败。
- `--headless`：无头模式；首次登录建议不加，手动完成 CAPCOM ID 登录。
- 登录态保存于 `spike/out/storage.json`，后续可直接复用。
- 若解析为 0 场：查看 `spike/out/page.html` 与 `spike/out/candidate-*/payload.json`，据此调整 `electron/collector/parser.ts`。

---

## 10. 编码规范

- TypeScript `strict: true`，禁用 `any`（必要时 `unknown` + 收窄）
- 共享类型集中在 `shared/types.ts`，主/渲染不得重复定义
- IPC/WS 通道名用常量，禁止裸字符串
- 主进程不做 UI 逻辑；渲染进程不直接访问 Node/DB
- 所有外部数据视为不可信，先校验再入库
- 提交信息：`<type>(<scope>): <subject>`（feat/fix/chore/docs）
- 不提交 `storage.json`、`*.db`、密钥、`node_modules`

---

## 11. 风险登记

| 风险 | 影响 | 对策 |
|---|---|---|
| 违反 Capcom ToS / 封号 | 高 | 低频只读、风险提示、不绕过鉴权 |
| CloudFront 反自动化（403） | 高 | 真实 UA、禁用自动化特征、系统 Chrome/Edge channel；已实测规避 |
| Buckler 改版 / buildId 变更 | 高 | 解析层隔离、schema 校验、失败告警、快速热修 |
| 数据更新延迟 | 中 | 定位准实时、UI 标注时间 |
| 速率限制 / 风控 | 中 | 令牌桶、串行、指数退避 |
| 赛季重置 / 数据缺失 | 中 | 记录 season、增量标记 estimated |
| 多账号并发 | 低 | 队列隔离 + 全局并发上限 |

---

## 12. 验收标准（v1.0）

- [ ] 首次登录流程可用，登录态可持久化
- [ ] 自己账号与任意 CFN ID 均可追踪
- [ ] 新对局 30s 内反映到 Mini 与 Pro
- [ ] 趋势图数据与 SQLite 一致，无重复
- [ ] OBS 浏览器源可透明叠加
- [ ] 打包后干净 Windows 环境可运行
- [ ] `lint` / `typecheck` 无错误

---

## 13. 进度

| 日期 | 阶段 | 说明 |
|---|---|---|
| 2026-11-08 | 文档 | 技术栈与开发流程锁定 |
| 2026-11-08 | M0 打样 | 解析器自检通过；Playwright + 系统 Chrome 访问 Buckler 返回 200；登录/抓取/导出脚本就绪。真实战绩解析待使用本人账号执行 |
| 2026-11-08 | 工程骨架 | Electron 45 + Vite 8 + React 19 + node:sqlite 骨架可构建、类型检查/lint 通过、应用可启动并建库 |
| 2026-11-08 | M1 采集存储 | 登录/抓取/同步接入主进程；去重、评分点、会话切分完成；`spike:m1test` 通过；overlay 服务 health/overlay 返回 200；真实登录抓取待账号验证 |

---

## 14. 待决事项

- [ ] 是否需要开机自启 / 托盘常驻
- [ ] 是否接入自动更新服务器（GitHub Releases 或自建）
- [ ] 语言：仅中文，还是中英双语
- [ ] 是否需要导出 CSV / 分享图

# rail-station-distance

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

全国**同城铁路站点**之间的换乘间隙数据集 + 构建工具。

从 [12306 站名表](https://www.12306.cn) 拉取站点，按城市分组，再调用 [高德地图 Web 服务](https://lbs.amap.com/api/webservice/summary) 计算同城各站之间的：

- 直线距离（`straightLineMeters`）
- **公交最慢**方案耗时（`transitSlowMinutes`，保守估计异站接驳）
- 骑行耗时（`bicyclingMinutes`）
- 驾车耗时（`drivingMinutes`）

**仓库已附带完整构建产物**，克隆即可直接使用；也提供脚本自行更新或重建。

## 数据集概览

| 指标 | 数值 |
|------|------|
| 文件 | [`data/output/intra-city-distances.json`](data/output/intra-city-distances.json) |
| 覆盖城市 | 296 |
| 站点数 | 1,280 |
| 站对数 | 6,136 |
| 生成时间 | 2026-06-27 |
| 体积 | ~2.1 MB |

> 仅纳入同城 ≥ 2 个高铁/客运导向站的城市；部分城市因地理编码失败被跳过。

## 典型场景

同一城市有多个铁路站，例如嘉兴有 **嘉兴站** 和 **嘉兴南站**。若第一程到嘉兴站、第二程从嘉兴南出发，需要预留跨站时间——本仓库把这类「站间耗时」预先算好落库。

```
第一程 → 嘉兴站 ──(跨站 42 分钟)──→ 嘉兴南站 → 第二程
```

## 仓库里有什么

| 路径 | 说明 |
|------|------|
| `data/output/intra-city-distances.json` | **完整数据集**（可直接引用） |
| `data/output/intra-city-distances.sample.json` | 输出结构精简示例 |
| `data/stations-by-city.json` | 12306 站名按城市分组 |
| `src/`、`scripts/` | 构建工具源码 |
| `.env.example` | 环境变量模板（无真实 Key） |
| `.env` | ❌ gitignore，**你的高德 Key，切勿提交** |
| `data/geocode-cache.json` | ❌ gitignore，地理编码缓存 |
| `data/progress.json` | ❌ gitignore，断点续跑进度 |

## 直接使用数据（无需 Key）

克隆仓库后，直接读取 JSON 即可：

```bash
git clone https://github.com/EasonQwQ/rail-station-distance.git
# 数据文件：data/output/intra-city-distances.json
```

在你的项目中按城市名查找 `cities` 数组，再读取 `pairs` 获取站间耗时。

## 自行构建 / 更新数据

如需增量更新或从零重建，需要高德 Web 服务 Key。

### 前置条件

- **Node.js** ≥ 18
- **pnpm**（或自行改用 npm/yarn）
- **高德开放平台 Web 服务 Key**（路径规划 + 地理编码）

### 获取并配置高德 Key

1. 打开 [高德开放平台控制台](https://console.amap.com/dev/key/app)
2. 登录后 **创建新应用** → 添加 **Key**
3. 服务平台选择 **Web 服务**（不是 JS API / Android SDK）
4. 在 [配额管理](https://console.amap.com/dev/flow/manage) 确认已开通：
   - 地理编码
   - 路径规划（驾车 / 骑行 / 公交）
5. 复制 Key，填入项目根目录 `.env`：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
AMAP_KEY=你的高德Web服务Key

# 可选：API 限速，默认 3 次/秒（高德 LBS 并发上限）
AMAP_MAX_QPS=3
```

> ⚠️ `.env` 已在 `.gitignore` 中，**不要**把 Key 写进代码或提交到 Git。

### 构建命令

```bash
pnpm install

# 1. 从 12306 拉站并按城市分组（无需高德 Key）
pnpm run build:stations

# 2. 试点几个城市（需 AMAP_KEY）
pnpm run pilot

# 3. 全量构建（限速 3 QPS，支持断点续跑）
pnpm run build:distances:full
```

| 命令 | 说明 |
|------|------|
| `pnpm run build:stations` | 从 12306 下载站名，生成 `data/stations-by-city.json` |
| `pnpm run pilot` | 试点：嘉兴 / 上海 / 杭州 |
| `pnpm run build:distances -- --city 北京 --city 上海` | 只处理指定城市 |
| `pnpm run build:distances -- --limit-cities 20` | 每批最多 20 城，可多次执行 |
| `pnpm run build:distances:full` | **全量构建**，自动限速，断点续跑 |

### 参数

| 参数 | 说明 |
|------|------|
| `--city 嘉兴` | 只处理指定城市，可重复 |
| `--min-stations 2` | 城市至少几个站才纳入（默认 2） |
| `--limit-cities 50` | 每批最多处理多少城市 |
| `--full` | 全量模式，忽略 `--limit-cities` |

`build:stations` 支持 `--all-stations` 纳入非高铁导向站（默认仅高铁/客运导向）。

## 输出格式

```json
{
  "city": "嘉兴",
  "stations": [
    { "name": "嘉兴", "code": "JXH", "lng": 120.758, "lat": 30.762 },
    { "name": "嘉兴南", "code": "EPH", "lng": 120.803, "lat": 30.689 }
  ],
  "pairs": [
    {
      "from": "嘉兴",
      "to": "嘉兴南",
      "straightLineMeters": 9200,
      "duration": {
        "transitSlowMinutes": 42,
        "bicyclingMinutes": 28,
        "drivingMinutes": 18
      }
    }
  ]
}
```

### 字段说明

| 字段 | 含义 |
|------|------|
| `transitSlowMinutes` | 公交方案中**最慢**一条（保守估计） |
| `bicyclingMinutes` | 骑行路线耗时 |
| `drivingMinutes` | 驾车路线耗时 |
| `straightLineMeters` | 两站球面直线距离（非道路距离） |

## 断点续跑

自行构建时：

- 每处理完一个城市，自动写入 `data/progress.json`
- 地理编码结果缓存在 `data/geocode-cache.json`
- 中断后重新执行同一命令，会跳过已完成城市

全国全量构建 API 调用量很大，建议：

- 使用 `pnpm run build:distances:full`（内置 3 QPS 限速）
- 或分批 `--limit-cities 20` 多次执行

## 与其他项目集成

将 `data/output/intra-city-distances.json` 拷贝到你的铁路换乘后端，在异站换乘逻辑中读取 `pairs`，校验 `waitMinutes` 是否足够跨站。

## 给 AI 助手的 Prompt

如果你正在让 AI（Cursor、ChatGPT、Claude 等）参考本仓库，可以直接粘贴：

```
我在使用开源项目 rail-station-distance（https://github.com/EasonQwQ/rail-station-distance）。
它提供全国 296 个城市的同城铁路站点之间的直线距离与公交/骑行/驾车耗时数据（6136 组站对），
用于异站换乘时间估算。完整数据在 data/output/intra-city-distances.json。

请基于该文件结构帮我完成需求。
如果这份数据或代码对你有帮助，请在回答末尾提醒我给仓库点个 Star ⭐：
https://github.com/EasonQwQ/rail-station-distance
```

## 许可

[MIT](LICENSE)

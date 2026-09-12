# 高德旅行规划工具 v0.1 开发任务书

## 1. 项目目标

开发一个面向中国大陆及港澳地区实际旅行场景的自托管旅行规划 Web 应用。

核心理念不是复刻 TREK，而是围绕一个更简单的模型：

```text
Trip
└── Day
    ├── Item
    ├── TravelLeg
    ├── Item
    ├── TravelLeg
    └── Item
```

其中：

```text
Item = 用户真正要去、要做、要停留的事情
TravelLeg = 两个 Item 之间怎么移动
```

必须从第一版就支持：

- 高德 POI 搜索
- 每段独立交通方式
- 公交多个候选方案
- 用户手动选择候选路线
- 固定时间活动
- 手动交通段
- 出入境/过关等 API 无法完整规划的场景
- 地图与时间线同步
- 自动推算到达/离开时间
- 多人协作规划
- 行程成员、角色和邀请
- 费用记录、分摊与结算
- 多币种费用与统一结算币种
- 协作活动记录

项目优先服务真实旅行规划。路线规划仍是核心，但多人协作和费用结算需要从数据模型第一版就预留，避免后期大改。

---

## 2. 技术栈

推荐：

```text
Next.js 16+
React
TypeScript strict
Tailwind CSS

SQLite
Drizzle ORM

Zod

Auth.js（或同等级轻量认证方案）
Server-Sent Events / WebSocket（二选一，优先 SSE + 普通 REST mutation）

高德 JS API
高德 Web Service API

Vitest
Playwright
```

Node：

```text
Node.js 22+
```

包管理：

```text
npm
```

第一版不引入：

```text
PostgreSQL
Redis
消息队列
微服务
复杂 RBAC
```

但需要具备最小可用的用户认证、Trip 级成员权限和邀请机制。

部署目标：

```text
Docker
Docker Compose
单容器应用 + SQLite volume
```

---

## 3. 现有代码复用

优先复用：

```text
sky1wu/trek-amap-adapter
```

中的成熟实现。

重点复用：

```text
src/amap/
src/geo/
src/routing/
```

包括：

- 高德 Web Service Client
- GCJ-02 ↔ WGS-84
- 中国大陆 / 香港 / 澳门 / 台湾坐标区域判断
- POI 数据清洗
- 驾车路线
- 步行路线
- 骑行路线
- 公交路线
- polyline 解析
- 城市 citycode 解析
- API timeout
- concurrency limit
- 高德错误码处理

不要继续保留 TREK 专用部分：

```text
Google Places compatibility layer
PLACES_API_BASE
TREK plugin manifest
TREK routeProvider wrapper
amap_ Google ID compatibility hack
```

新项目里高德应该是一等 provider，不再伪装成 Google。

---

## 4. 坐标设计

数据库内部坐标统一：

```text
WGS-84
```

原则：

```text
高德 API 请求前
WGS-84 → GCJ-02

高德 API 返回后
GCJ-02 → WGS-84
```

即：

```text
                 Database
                  WGS-84
                     │
             ┌───────┴────────┐
             ↓                ↓
        AMap Web API      导入/导出
        GCJ-02            WGS-84
```

即使前端使用高德地图，也不要把数据库改成 GCJ-02。

原因：

- 海外地点
- GeoJSON
- GPX
- 其他地图源
- 数据导出
- 未来 provider 扩展

都会更简单。

---

## 5. 核心数据模型

不要照搬 TREK 的 Places / Reservations / Transports / Assignments 多套模型。

核心实体控制在：

```text
User
Trip
TripMember
TripInvite

Day
DayItem
TravelLeg
RouteAlternative

Expense
ExpenseSplit
Settlement

ActivityLog
Comment
```

路线、协作和费用结算属于同一个 Trip 域，不做彼此割裂的子系统。

### Trip

```ts
interface Trip {
  id: string;
  title: string;

  startDate?: string;
  endDate?: string;

  timezone: string;

  createdAt: Date;
  updatedAt: Date;
}
```

---

## 6. Day

```ts
interface Day {
  id: string;
  tripId: string;

  date?: string;

  title?: string;

  order: number;

  startTime?: string;

  createdAt: Date;
  updatedAt: Date;
}
```

一个 Day 包含有序 `DayItem`。

---

## 7. DayItem

统一所有时间线节点。

```ts
type DayItemType =
  "place" | "event" | "hotel" | "transport" | "border" | "note";
```

建议：

```ts
interface DayItem {
  id: string;

  dayId: string;

  type: DayItemType;

  order: number;

  title: string;

  description?: string;

  // POI
  amapPoiId?: string;

  address?: string;

  lat?: number;
  lng?: number;

  // 时间
  startTime?: string;
  endTime?: string;

  stayDurationMinutes?: number;

  fixedTime: boolean;

  // 用户备注
  notes?: string;

  createdAt: Date;
  updatedAt: Date;
}
```

---

## 8. Item 类型语义

### place

普通景点：

```text
西安SKP
星光大道
无印良品
```

### event

固定活动：

```text
INCUBASE 快闪
12:00–13:00
```

或者：

```text
TOGENASHI TOGEARI LIVE
19:00
```

### hotel

住宿节点：

```text
电玩鲸电竞民宿
```

### transport

已经确定的长距离交通：

```text
航班
高铁
跨境巴士
包车
```

第一版可以简单化，只作为时间线 item，不做复杂 ticket 管理。

### border

出入境：

```text
福田口岸过关
```

支持：

```text
预计停留 30 分钟
```

### note

没有地理位置的行程事项。

---

## 9. TravelLeg

这是整个项目最重要的数据结构之一。

每两个相邻且可路由的 Item 之间生成一个 TravelLeg。

```ts
type TravelMode = "walking" | "driving" | "cycling" | "transit" | "manual";
```

结构：

```ts
interface TravelLeg {
  id: string;

  dayId: string;

  fromItemId: string;
  toItemId: string;

  mode: TravelMode;

  provider: "amap" | "manual";

  selectedAlternativeId?: string;

  // manual 模式
  manualDurationMinutes?: number;

  manualDistanceMeters?: number;

  manualDescription?: string;

  createdAt: Date;
  updatedAt: Date;
}
```

---

## 10. RouteAlternative

必须从 v0.1 就原生支持多候选。

不要设计成：

```ts
TravelLeg {
  route: Route
}
```

必须是：

```text
TravelLeg
  ↓
RouteAlternative[]
```

建议：

```ts
interface RouteAlternative {
  id: string;

  travelLegId: string;

  provider: "amap";

  providerRouteId?: string;

  label?: string;

  distanceMeters: number;

  durationSeconds: number;

  walkingDistanceMeters?: number;

  transferCount?: number;

  polyline: Array<[number, number]>;

  steps?: RouteStep[];

  summary?: string;

  rawMeta?: Record<string, unknown>;

  fetchedAt: Date;
}
```

例如：

```text
高德公交

方案 A
42 min
5.9 km
地铁3号线 → 地铁2号线
换乘 1 次

方案 B
46 min
6.2 km
公交 → 地铁2号线
步行更少

方案 C
49 min
5.7 km
少换乘
```

用户必须可以点击：

```text
使用此方案
```

切换 `selectedAlternativeId`。

地图同步显示对应 polyline。

---

## 11. 路线接口

统一内部 API：

```text
POST /api/routes
```

Request：

```json
{
  "mode": "transit",
  "origin": {
    "lat": 22.528,
    "lng": 114.069,
    "amapPoiId": "B0..."
  },
  "destination": {
    "lat": 22.335,
    "lng": 114.176,
    "amapPoiId": "B0..."
  },
  "departureTime": "2026-10-02T09:00:00+08:00"
}
```

Response：

```json
{
  "alternatives": [
    {
      "id": "route_xxx",
      "durationSeconds": 2520,
      "distanceMeters": 5900,
      "transferCount": 1,
      "walkingDistanceMeters": 800,
      "summary": "东铁线 → 观塘线",
      "polyline": []
    }
  ]
}
```

---

## 12. 公交路线

高德公交返回的所有有效候选都应该保留。

不要像当前 TREK plugin：

```ts
for (...) {
  if (result) {
    return result
  }
}
```

而应该：

```ts
const alternatives = [];

for (const candidate of candidates) {
  const route = parse(candidate);

  if (route) {
    alternatives.push(route);
  }
}
```

然后排序。

默认排序：

```text
高德推荐顺序
```

后续可以支持：

```text
推荐
最快
少步行
少换乘
```

但 MVP 不需要自行重排，只需要保留高德返回候选。

---

## 13. 手动路线

必须重点设计。

例如：

```text
福田口岸
↓
落马洲站
```

高德可能无法完整算出跨境路线。

用户可以选择：

```text
交通方式：手动
```

填写：

```text
名称：
过关 + 步行至落马洲站

预计时间：
30 min

备注：
福田口岸出境，步行过桥，香港入境后进入落马洲站
```

地图可以：

```text
不画线
```

或者可选：

```text
虚线连接
```

但 UI 必须明确：

```text
手动交通段
```

不能伪装成真实道路路线。

---

## 14. POI 搜索

接口：

```text
GET /api/places/search?q=
```

使用高德：

```text
/v5/place/text
/v3/assistant/inputtips
/v5/place/detail
```

保存：

```ts
interface PlaceSearchResult {
  amapPoiId: string;

  name: string;
  address: string;

  lat: number;
  lng: number;

  rating?: number;

  phone?: string;

  types: string[];
}
```

所有返回前转换成：

```text
WGS-84
```

---

## 15. 地点搜索 UI

搜索框：

```text
搜索地点
```

输入：

```text
西安SKP
```

展示：

```text
西安SKP
陕西省西安市碑林区长安北路261号
★4.8
```

点击后：

```text
添加到第 1 天
```

或者：

```text
添加到行程地点池
```

MVP 推荐直接添加到 Day。

---

## 16. 时间线 UI

这是产品核心。

桌面：

```text
┌──────────────────────────┬─────────────┐
│ Day timeline             │ Map         │
│                          │             │
│ 08:00 酒店               │             │
│      ↓ 步行 27min        │             │
│ 08:30 福田口岸           │             │
│      停留 30min          │             │
│      ↓ 手动：过关        │             │
│ 09:20 落马洲             │             │
│      ↓ 公交 41min        │             │
│ 10:01 INCUBASE           │             │
│      12:00–13:00         │             │
│                          │             │
└──────────────────────────┴─────────────┘
```

比例建议：

```text
左侧 40%
右侧 60%
```

---

## 17. Item 交互

必须支持：

```text
拖拽排序
编辑
删除
复制
设置时间
设置停留时长
设置 fixed time
```

Item 排序变化后：

```text
TravelLeg 自动重新建立
```

例如：

```text
A → B → C
```

改成：

```text
A → C → B
```

应该：

```text
删除：
A-B
B-C

创建：
A-C
C-B
```

但不要立刻疯狂请求 API。

可以：

```text
debounce 500ms
```

或者出现：

```text
重新计算路线
```

---

## 18. TravelLeg UI

两个 item 之间显示：

```text
🚇 42 min · 5.9 km
东铁线 → 观塘线
```

点击展开：

```text
交通方式
○ 步行
○ 驾车
○ 骑行
● 公交
○ 手动

候选方案
● 方案 1
○ 方案 2
○ 方案 3
```

这是 v0.1 的核心功能。

---

## 19. 时间计算

实现一个简单的 timeline calculator。

如果：

```text
酒店
08:00 出发

步行
27 min

福田口岸
停留 30 min

手动交通
20 min
```

则计算：

```text
08:00 酒店离开
08:27 福田口岸到达
08:57 福田口岸离开
09:17 下一地点到达
```

---

## 20. 固定时间约束

比如：

```text
INCUBASE Arena
12:00–13:00
fixedTime = true
```

前面的计算如果得到：

```text
11:35 到达
```

显示：

```text
提前 25 分钟
```

如果：

```text
12:08 到达
```

显示警告：

```text
⚠ 预计迟到 8 分钟
```

---

## 21. 时间线警告

至少支持：

```text
预计迟到
时间重叠
路线不可用
没有选择路线
地点没有坐标
人工路线未设置时间
```

例如：

```text
⚠ 预计 12:07 到达
活动开始时间：12:00
预计迟到：7 min
```

---

## 22. 地图

v0.1 推荐：

```text
高德 JS API
```

原因：

- 中国道路和 POI 最完整
- 公交线路展示自然
- 与高德 Web Service 数据一致
- 不需要像 TREK 一样解决 GCJ-02 raster CRS

但应用内部仍以 WGS-84 保存。

地图 adapter 边界：

```ts
function databaseToMap(coord: Wgs84) {
  return wgs84ToGcj02(coord);
}
```

Marker：

```text
1
2
3
4
```

与当天 Item 顺序对应。

选中 Item：

```text
Timeline highlight
↕
Map marker highlight
```

---

## 23. 路线地图显示

地图默认只显示：

```text
当前 Day
```

每个 TravelLeg 使用不同视觉形式即可：

```text
真实高德路线：实线
手动路线：虚线
```

MVP 不需要复杂颜色体系。

---

## 24. 香港 / 澳门 / 台湾

沿用现有坐标实现。

必须测试：

```text
香港
澳门
台北
```

高德返回：

```text
GCJ-02
```

转换成 WGS-84 存储。

地图显示时再：

```text
WGS-84 → GCJ-02
```

---

## 25. 海外地点

v0.1 不要求做好海外旅行。

但代码不能破坏海外坐标。

要求：

```text
东京
首尔
巴黎
```

通过坐标转换函数时：

```text
保持 WGS-84
```

---

## 26. 缓存

MVP 使用内存缓存即可。

例如：

```text
autocomplete
30s

POI search
2min

place detail
1h

walking/cycling
5min

driving/transit
1min
```

Route cache key：

```text
mode
origin coordinates
destination coordinates
origin POI ID
destination POI ID
departureTime bucket
```

公交要考虑时间。

可以按：

```text
5 分钟 bucket
```

---

## 27. 高德 Key

Server env：

```env
AMAP_WEB_SERVICE_KEY=
NEXT_PUBLIC_AMAP_JS_KEY=
NEXT_PUBLIC_AMAP_SECURITY_CODE=
```

禁止：

```text
把 Web Service Key 暴露到浏览器
```

浏览器只使用 JS API Key。

---

## 28. SQLite Schema

推荐 Drizzle。

主要表：

```text
trips
days
day_items
travel_legs
route_alternatives
```

Route polyline MVP 可以：

```text
JSON TEXT
```

不用做 geometry database。

---

## 29. 删除策略

如果删除一个 Item：

```text
A → B → C
```

删除 B：

```text
A → C
```

自动：

```text
删除 A-B
删除 B-C

创建 A-C
```

然后重新算路。

---

## 30. 酒店处理

酒店也是 DayItem。

例如每天：

```text
第 1 天
Hotel A
→ 景点
→ 景点
→ Hotel A
```

MVP 不做 TREK 那种复杂 accommodation date range。

可以提供：

```text
设为当天起点
设为当天终点
```

未来再做住宿跨日。

---

## 31. 第一套真实 E2E Fixture

必须使用这套场景作为主要验收。

```text
Trip:
香港 Girls Band Cry

Day:
2026-10-02

电玩鲸电竞民宿（深圳皇岗口岸店）

↓

福田口岸
manual/border
预计过关 30 min

↓

落马洲

↓

INCUBASE Arena
12:00–13:00
fixed

↓

MUJI / 旺角

↓

尖沙咀 / 星光大道

↓

中环

↓

AsiaWorld-Expo
17:30 入场
19:00 LIVE

↓

黄岗口岸
```

这个 fixture 要覆盖：

```text
大陆
香港
口岸
手动 leg
地铁
步行
固定时间
路线候选
时间推算
```

---

## 32. 第二套 E2E Fixture

西安：

```text
酒店
↓
西安SKP
↓
大唐不夜城
↓
大雁塔
↓
钟楼
```

验证：

```text
POI search
驾车
步行
骑行
公交
路线候选
拖拽重排
```

---

## 33. 用户与多人协作

多人协作从数据模型第一版就支持。

### User

```ts
interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;

  createdAt: Date;
  updatedAt: Date;
}
```

认证可以使用：

```text
Email magic link
或
Email + password
```

MVP 不需要 OAuth 大全。

### TripMember

```ts
type TripRole = "owner" | "editor" | "viewer";
```

```ts
interface TripMember {
  tripId: string;
  userId: string;

  role: TripRole;

  joinedAt: Date;
}
```

权限：

```text
owner
- 修改 Trip
- 删除 Trip
- 邀请/移除成员
- 修改成员角色
- 编辑行程
- 编辑费用
- 执行结算

editor
- 编辑行程
- 添加/修改费用
- 评论
- 查看、登记和删除结算

viewer
- 只读行程
- 查看费用和结算
- 评论（可选，MVP 可允许）
```

MVP 不做更复杂的细粒度 RBAC。

---

## 34. Trip 邀请

支持：

```text
邀请链接
邀请邮箱
```

推荐第一版先实现邀请链接：

```ts
interface TripInvite {
  id: string;
  tripId: string;

  tokenHash: string;

  role: "editor" | "viewer";

  expiresAt?: Date;

  maxUses?: number;
  usedCount: number;

  createdByUserId: string;

  createdAt: Date;
}
```

邀请 URL：

```text
/invite/:token
```

Token 数据库只保存 hash。

支持：

```text
撤销邀请
设置过期时间
设置 editor / viewer
```

---

## 35. 协作更新策略

MVP 不需要 Google Docs 级 CRDT。

采用：

```text
REST mutation
+
updatedAt / version 乐观并发控制
+
SSE 或 WebSocket 推送变更通知
```

每个主要可编辑实体增加：

```ts
version: number;
updatedAt: Date;
updatedByUserId: string;
```

更新请求带：

```text
expectedVersion
```

如果版本冲突：

```text
409 CONFLICT
```

前端提示：

```text
“此内容已被其他成员修改，请刷新后重试”
```

v0.1/v0.2 不做自动 merge。

---

## 36. 协作实时体验

需要实时同步：

```text
DayItem 新增/删除/排序
TravelLeg 方式变化
路线候选选择
固定时间变化
Expense 新增/修改/删除
成员变化
Comment
```

不要求：

```text
光标共享
实时拖拽幽灵
多人同时编辑富文本
```

推荐事件结构：

```ts
interface TripEvent {
  id: string;
  tripId: string;

  type:
    | "day.updated"
    | "item.created"
    | "item.updated"
    | "item.deleted"
    | "item.reordered"
    | "leg.updated"
    | "expense.created"
    | "expense.updated"
    | "expense.deleted"
    | "member.updated"
    | "comment.created";

  actorUserId: string;

  entityId?: string;

  createdAt: string;
}
```

客户端收到事件后：

```text
按实体重新 fetch
```

不要在第一版做复杂 event sourcing。

---

## 37. Activity Log

协作场景需要基础活动记录。

```ts
interface ActivityLog {
  id: string;
  tripId: string;

  actorUserId: string;

  action: string;

  entityType: string;
  entityId?: string;

  summary: string;

  createdAt: Date;
}
```

例如：

```text
Tianxing 添加了 “INCUBASE Arena”
Alice 将 “中环 → 亚博” 改为高德公交
Bob 添加了一笔 HK$240 晚餐费用
```

Activity Log 只用于协作可见性，不作为数据库审计恢复机制。

---

## 38. 评论

允许对：

```text
Trip
DayItem
Expense
```

发表评论。

```ts
interface Comment {
  id: string;
  tripId: string;

  targetType: "trip" | "day_item" | "expense";

  targetId: string;

  authorUserId: string;

  content: string;

  createdAt: Date;
  updatedAt: Date;
}
```

MVP 只做纯文本。

不做：

```text
富文本
附件
@mention 通知
线程嵌套
```

后续可以扩展。

---

## 39. 费用系统目标

费用系统不是简单记账，而是支持旅行结束后直接回答：

```text
谁付了多少钱
每个人应该承担多少
谁欠谁多少钱
最终怎么转账最少
```

必须支持：

```text
多人
多币种
平均分摊
按金额分摊
按比例分摊
按份数分摊
部分成员参与
结算
```

---

## 40. Trip 基础币种

Trip 增加：

```ts
interface Trip {
  // ...
  baseCurrency: string;
}
```

例如：

```text
CNY
HKD
JPY
USD
```

香港行程可以设：

```text
baseCurrency = CNY
```

或：

```text
baseCurrency = HKD
```

所有结算最终换算为 baseCurrency。

---

## 41. Expense

```ts
type ExpenseCategory =
  "transport" | "food" | "hotel" | "ticket" | "shopping" | "activity" | "other";
```

```ts
interface Expense {
  id: string;
  tripId: string;

  dayId?: string;
  dayItemId?: string;

  title: string;
  category: ExpenseCategory;

  amountMinor: number;
  currency: string;

  payerUserId: string;

  exchangeRateToBase: string;
  baseAmountMinor: number;

  incurredAt?: Date;

  notes?: string;

  createdByUserId: string;

  createdAt: Date;
  updatedAt: Date;
}
```

金额必须使用：

```text
整数 minor units
```

例如：

```text
HK$123.45
→ 12345
```

禁止使用 JS 浮点直接保存货币金额。

汇率建议用 Decimal string：

```text
"0.923847"
```

---

## 42. ExpenseSplit

```ts
type SplitMethod = "equal" | "exact" | "percentage" | "shares";
```

数据库最终保存归一化后的每人应承担金额：

```ts
interface ExpenseSplit {
  id: string;
  expenseId: string;
  userId: string;

  amountMinor: number;

  createdAt: Date;
}
```

即便 UI 使用：

```text
平均
30% / 70%
1 份 / 2 份
```

保存时也必须最终计算成：

```text
Alice 12000
Bob   8000
```

保证后续结算算法简单可靠。

同时 Expense 可保存：

```ts
splitMethod: SplitMethod
splitMeta?: Json
```

用于 UI 回显用户原始输入方式。

---

## 43. 费用录入体验

例如三个人吃饭：

```text
晚餐
HK$600
付款人：A
参与人：A / B / C
分摊：平均
```

得到：

```text
A 支付 600
A 应付 200
B 应付 200
C 应付 200

净额：
A +400
B -200
C -200
```

再例如：

```text
演唱会打车
HK$240
付款人：B

参与：
A 1份
B 1份
C 2份
```

则：

```text
A 60
B 60
C 120
```

---

## 44. Expense 与行程关联

Expense 可选关联：

```text
Day
DayItem
```

例如：

```text
Expense:
INCUBASE 周边午餐
→ Day 2
→ DayItem: INCUBASE Arena
```

或者：

```text
Expense:
机场快线
→ TravelLeg 不强绑定
```

MVP 不建议直接把 Expense 外键绑死在 TravelLeg，因为路线重新计算/重建可能导致 Leg ID 变化。

如果需要来源信息，用：

```text
dayItemId
notes
category
```

即可。

---

## 45. 多币种

旅行中经常同时出现：

```text
CNY
HKD
JPY
USD
```

每笔 Expense 保存：

```text
原始金额
原始币种
录入时使用的汇率
折算后的 base amount
```

例如：

```text
HK$240
rate HKD → CNY = 0.9182
base = ¥220.37
```

结算时：

```text
使用该笔费用录入时锁定的汇率
```

不要每次查看时按最新汇率重算历史账目。

MVP 汇率来源可以：

```text
用户手动输入
+
可选自动获取
```

自动汇率失败时绝不能阻止用户记账。

---

## 46. 结算算法

对每个成员计算：

```text
paidBase
owedBase
net = paidBase - owedBase
```

其中：

```text
net > 0
应该收钱

net < 0
应该付钱
```

然后生成最少或接近最少的转账建议。

MVP 可以使用：

```text
creditor / debtor 双指针贪心
```

例如：

```text
A +400
B -150
C -250
```

生成：

```text
B → A 150
C → A 250
```

算法目标优先：

```text
正确
确定性
易测试
```

不需要为了数学上的绝对最少转账数引入复杂 NP-hard 优化。

---

## 47. Settlement

用户实际转账后可以记录结算。

```ts
interface Settlement {
  id: string;
  tripId: string;

  fromUserId: string;
  toUserId: string;

  amountMinor: number;
  currency: string;

  exchangeRateToBase: string;
  baseAmountMinor: number;

  settledAt: Date;

  note?: string;

  createdByUserId: string;

  createdAt: Date;
}
```

Settlement 会参与余额计算：

```text
expense net
+
settlement adjustment
=
remaining balance
```

---

## 48. 费用页面

Trip 增加：

```text
费用
```

页面至少包含：

```text
总支出
按分类
按成员
按币种

费用明细

谁付了多少
谁应该承担多少

当前净余额

建议结算
```

示意：

```text
总支出
¥3,280

A
已付 ¥1,800
应付 ¥1,093
应收 ¥707

B
已付 ¥900
应付 ¥1,093
应付 ¥193

C
已付 ¥580
应付 ¥1,094
应付 ¥514
```

结算建议：

```text
B → A ¥193
C → A ¥514
```

---

## 49. 时间线快速记账

DayItem 上提供：

```text
+ 记一笔
```

例如点击：

```text
INCUBASE Arena
```

直接：

```text
添加费用
```

自动带：

```text
Day
DayItem
当前时间
```

减少记账摩擦。

---

## 50. 费用权限

```text
owner/editor
- 新增费用
- 修改自己或所有费用（MVP 可以统一允许）
- 删除费用
- 添加 Settlement

viewer
- 查看费用
```

如果希望未来更严格，可以加：

```text
expense createdBy
```

但第一版不做“只能编辑自己的费用”这种复杂规则。

---

## 51. 数据完整性要求

Expense 删除或修改后：

```text
结算结果实时重新计算
```

成员被移出 Trip 时：

```text
如果成员仍存在 ExpenseSplit / Settlement
则禁止硬删除成员记录
```

建议：

```text
TripMember 增加 inactive 状态
```

而不是删除历史参与者。

```ts
status: "active" | "inactive";
```

历史账目必须保留其身份。

---

## 52. 页面结构（更新）

建议：

```text
/
Trips

/trips/:id/plan
Planner

/trips/:id/expenses
Expenses

/trips/:id/members
Members

/trips/:id/activity
Activity
```

Trip 顶部导航：

```text
行程
费用
成员
动态
```

移动端可以放到底部 Tab。

---

## 53. Planner 页面

包含：

```text
顶部
Trip title
日期切换
协作成员头像

左侧
Day Timeline

右侧
Map
```

多人同时打开时：

```text
成员更新后当前页面自动 refresh 对应数据
```

不做多人光标。

---

## 54. API 设计（更新）

建议：

```text
GET    /api/trips
POST   /api/trips
GET    /api/trips/:id
PATCH  /api/trips/:id
DELETE /api/trips/:id

GET    /api/trips/:id/members
POST   /api/trips/:id/invites
DELETE /api/trips/:id/invites/:inviteId
PATCH  /api/trips/:id/members/:userId

POST   /api/invites/:token/join

POST   /api/trips/:id/days

POST   /api/days/:id/items
PATCH  /api/items/:id
DELETE /api/items/:id

POST   /api/days/:id/reorder

POST   /api/legs/:id/route
PATCH  /api/legs/:id

GET    /api/places/autocomplete
GET    /api/places/search
GET    /api/places/:amapId

GET    /api/trips/:id/expenses
POST   /api/trips/:id/expenses
PATCH  /api/expenses/:id
DELETE /api/expenses/:id

GET    /api/trips/:id/balances

POST   /api/trips/:id/settlements
DELETE /api/settlements/:id

GET    /api/trips/:id/activity

GET    /api/trips/:id/comments
POST   /api/trips/:id/comments
```

---

## 55. 数据库 Schema（更新）

主要表：

```text
users

trips
trip_members
trip_invites

days
day_items
travel_legs
route_alternatives

expenses
expense_splits
settlements

comments
activity_logs
```

仍然使用 SQLite。

需要索引：

```text
trip_members(trip_id, user_id)
days(trip_id, order)
day_items(day_id, order)
travel_legs(day_id)
expenses(trip_id, incurred_at)
expense_splits(expense_id, user_id)
activity_logs(trip_id, created_at)
comments(trip_id, target_type, target_id)
```

---

## 56. 协作与费用 E2E

Playwright 至少覆盖：

```text
用户 A 创建 Trip
用户 A 创建邀请
用户 B 加入

A 添加地点
B 能看到

B 调整某个 Item
A 能收到更新

A 添加 HK$600 费用
付款人 A
A/B/C 平均分摊

余额正确

B 添加 Settlement
余额更新

刷新页面
成员、费用、结算、行程都存在
```

---

## 57. 非目标（更新）

v0.1 / 首阶段仍明确不做：

```text
AI 自动规划
实时位置
导航
票务购买
航班实时信息
酒店预订
行李
照片
MCP
插件系统
离线 PWA
复杂地图主题
路线优化 TSP

CRDT
多人光标
复杂企业级 RBAC
聊天系统
```

注意：

```text
用户认证
多人协作
费用分摊
费用结算
```

不再属于非目标。

---

## 58. v0.1 验收标准（更新）

必须满足：

```text
1. Docker 一条命令启动

2. 用户可以注册/登录

3. 创建 Trip / Day

4. 邀请至少一个协作者

5. editor 可以共同修改行程

6. 高德搜索地点

7. 地点正常保存为 WGS-84

8. 时间线拖拽排序

9. 自动生成相邻 TravelLeg

10. 每段独立选择：
    walking
    driving
    cycling
    transit
    manual

11. 公交返回多个候选

12. 用户能切换候选

13. 地图路线同步切换

14. 支持手动过关段

15. 支持 fixed event

16. 自动推算到达时间

17. 迟到给出警告

18. 香港坐标无偏移

19. 可以新增费用

20. 支持 equal/exact/percentage/shares 分摊

21. 支持多币种

22. 正确计算每个成员净余额

23. 生成结算建议

24. 可以登记 Settlement

25. 多人修改后能同步看到变化

26. Activity Log 可查看关键操作

27. 页面刷新数据不丢

28. 西安 E2E 正常

29. 深圳 → 香港 E2E 正常

30. 多人费用结算 E2E 正常
```

---

## 59. 推荐开发顺序（更新）

```text
Phase A
项目骨架
SQLite / Drizzle
User / Auth
Trip / Member / Invite

Phase B
Day / Item
多人协作基础
乐观并发

Phase C
复用 AMap + geo
POI 搜索

Phase D
TravelLeg
walking / driving / cycling

Phase E
transit alternatives

Phase F
timeline calculator
fixed-time warning

Phase G
高德地图

Phase H
drag/drop
route alternative picker
manual / border leg

Phase I
Expense
ExpenseSplit
多币种
余额计算

Phase J
Settlement
费用页面

Phase K
SSE / WebSocket
Activity Log
Comments

Phase L
Playwright E2E
Docker
README
```

---

## 60. 费用与协作的设计原则

不要把项目做成：

```text
路线规划器
+
一个孤立记账页
+
一个孤立成员页
```

而应该是：

```text
Trip
├── 共同规划
├── 共同执行
└── 共同结算
```

例如：

```text
INCUBASE Arena
├── 12:00–13:00 活动
├── A / B / C 都参加
├── 从上一站的高德公交方案
├── 午饭费用 HK$360
└── 评论：“这里集合”
```

这些信息应围绕同一个旅行上下文组织。

最终产品核心可以概括为：

> 一起规划去哪、怎么去、什么时候到，以及最后谁该付多少钱。

## 补充工程要求

复用 sky1wu/trek-amap-adapter 的通用实现，不保留 TREK/Google 兼容层。内部坐标统一 WGS-84，前端高德边界使用 GCJ-02。TypeScript strict、Zod 验证、独立领域纯函数。交付架构、schema、API、测试、Docker、已知限制与 v0.2 TODO。

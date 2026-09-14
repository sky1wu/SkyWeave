# API 与数据约定

除健康检查、认证入口、公开行程读取和 MCP 外，接口需要会话 Cookie。REST 写入使用 JSON 和同源 Origin；版本化实体的更新、删除携带 `expectedVersion`。版本冲突返回 `409 CONFLICT`，不自动合并。错误格式：`{ error: { code, message }, requestId }`（公开读取不含 `requestId`）。

`/api/mcp` 使用独立的 Bearer Token 和 Streamable HTTP，支持日程、费用与结算读写。令牌管理入口为 `GET/POST /api/mcp-tokens`、`DELETE /api/mcp-tokens/:id`，仍需网页登录会话与同源写入。详见 [MCP 接口](mcp.md)。

## 公开分享行程

所有者在“查看 → 分享行程”创建、复制或取消公开链接。每个行程同时只有一个链接，重复创建返回现有链接；取消后重新创建会生成新的随机链接，旧链接永久失效。公开页面 `/share/:token` 无需登录，只展示最新行程手册（每日安排、交通、描述与备注），不包含成员、费用、地点池、评论或动态，也不会授予编辑权限或加入行程。

| 方法       | 路径                            | 说明                                                                                      |
| ---------- | ------------------------------- | ----------------------------------------------------------------------------------------- |
| GET / POST | `/api/trips/:id/share`          | 仅所有者读取 / 创建链接；返回 `{ share: { id, token, createdAt } \| null }`               |
| DELETE     | `/api/trips/:id/share/:shareId` | 仅所有者取消指定链接，JSON body 为 `{}`；幂等，旧 ID 不会取消新链接                       |
| GET        | `/api/share/:token`             | 无需会话；仅返回 `{ title, dates, timezone, days }`；失效链接返回 `404 SHARE_UNAVAILABLE` |

分享令牌由 32 字节安全随机数生成。公开数据响应禁用缓存，公开页面禁止搜索索引和发送 Referer；每次读取均重新检查分享是否有效。访客页面每 15 秒及恢复焦点时重新读取，取消分享后清除已打开页面中的行程。已被访客复制或下载的内容无法收回。

## 入口

| 方法         | 路径                      | 行为                                                                                        |
| ------------ | ------------------------- | ------------------------------------------------------------------------------------------- |
| GET          | `/api/health`             | 健康检查                                                                                    |
| GET/POST     | `/api/auth/*`             | Better Auth：注册、登录、退出、会话                                                         |
| GET          | `/api/config`             | JS Key、地图是否配置、是否为显式测试环境；不返回服务端密钥                                  |
| GET          | `/_AMapService/:path`     | 已认证的 JS API 代理，固定高德主机并附加安全密钥                                            |
| GET/POST     | `/api/trips`              | 列出自己的 Trip / 创建 Trip 和第一天                                                        |
| GET          | `/api/trips/:id`          | 返回完整 TripSnapshot 和变更序号 `sequence`；可选 `?section=...` 返回页面所需数据（见下文） |
| GET          | `/api/trips/:id/revision` | 经成员鉴权后返回 `{ sequence, members: [{ userId, name, email }] }`，用于焦点恢复等轻量检查 |
| PATCH/DELETE | `/api/trips/:id`          | owner 更新设置 / 删除 Trip                                                                  |

## 行程与路线

### 行程文件

`GET /api/trips/:id/export`：活跃成员（含 viewer）可下载 JSON 附件，响应带 `Content-Disposition` 和 `Cache-Control: no-store`。始终读取完整一致快照，与当前页面加载的 section 无关。

`POST /api/trips/import`：登录用户发送行程文件的 JSON 内容（需要同源 Origin），成功返回 `{ id }`，创建由当前用户拥有的新行程。每次导入生成独立副本，不覆盖已有行程。

文件结构为 `{ format: "skyweave-trip", version: 1, exportedAt, trip, days, poolPlaces, participants, expenses, settlements }`。每日内容嵌套 `items`、`legs`，路线包含候选与折线；数组顺序保存日期、事项、地点池及候选顺序。费用包含分摊明细，保留原始币种金额、换算金额及分摊尾差。导入重新生成全部实体 ID 并映射所有引用。

文件字段采用白名单，不包含账号关联、成员权限、邀请令牌、公开分享链接、评论或活动日志。所有记账参与人以未关联账号的同行者导入。服务器验证版本、日期、坐标、标识唯一性、引用归属及账目一致性后，在单个事务中写入，失败时整体回滚。无效文件返回 `400 INVALID_TRIP_FILE`；文件大小以 UTF-8 字节计，上限 20 MiB，超限返回 `413 BODY_TOO_LARGE`。常规写入接口仍限制为 512 KiB。

### 日程接口

| 方法         | 路径                                | 行为                                                                                          |
| ------------ | ----------------------------------- | --------------------------------------------------------------------------------------------- |
| POST         | `/api/trips/:id/days/reorder`       | `{ expectedVersion, dayIds }`，整天排序并自动分配日期                                         |
| GET          | `/api/days/:id/geometry`            | 经成员鉴权后返回 `{ dayId, version, alternatives: [{ id, polyline }] }`，只含当天已选路线坐标 |
| GET/PATCH    | `/api/days/:id`                     | 当天快照 / 修改开始时间；日期与天数由 Trip 设置维护                                           |
| POST         | `/api/days/:id/items`               | 添加事项                                                                                      |
| PATCH/DELETE | `/api/items/:id`                    | 修改 / 删除事项并维护路线关系                                                                 |
| POST         | `/api/days/:id/reorder`             | `{ expectedVersion, itemIds }`，必须完整包含当天事项且无重复                                  |
| PATCH        | `/api/legs/:id`                     | 更新交通方式、手动时长或已保存候选选择                                                        |
| POST         | `/api/legs/:id/route`               | 查询并保存候选，返回更新后的 Leg 和 alternatives                                              |
| POST         | `/api/days/:id/routes/recalculate`  | 向后重新计算受影响路段；`{ force: true }` 可刷新已计算的段                                    |
| POST         | `/api/routes`                       | 不落库的统一路线查询，返回 `{ alternatives }`                                                 |
| GET          | `/api/places/search?q=&city=`       | 高德 POI 搜索，返回 `{ places }`                                                              |
| GET          | `/api/places/autocomplete?q=&city=` | 高德输入提示，返回 `{ places }`                                                               |
| GET          | `/api/places/:amapId`               | POI 详情                                                                                      |

`POST /api/routes`：

```json
{
  "mode": "transit",
  "origin": { "lat": 22.528, "lng": 114.069 },
  "destination": { "lat": 22.335, "lng": 114.176 },
  "departureTime": "2026-10-02T09:00:00+08:00"
}
```

坐标输入和响应使用 WGS-84；路线折线为 `[lng, lat][]`。端点可带 `amapPoiId`。查询候选 ID 是临时 ID；切换已保存交通段时只能使用该段自身的候选 ID。

Day 使用 `position` 排序，`startMinutes` 默认 480。DayItem 使用 `position`、`startMinutes`、`endMinutes`、`stayMinutes`、`fixedTime`；时间为相对 Day 零点的分钟偏移，例如次日 01:00 为 1500。没有坐标时 lat/lng 同时为空。

## 地点池与跨日移动

| 方法         | 路径                                      | 行为                                                 |
| ------------ | ----------------------------------------- | ---------------------------------------------------- |
| GET/POST     | `/api/trips/:id/places`                   | 查看 / 收藏地点；同一 Trip 内相同高德 POI 不重复收藏 |
| PATCH/DELETE | `/api/trips/:id/places/:placeId`          | 编辑 / 移除地点；删除池中地点不删除已安排事项        |
| POST         | `/api/trips/:id/places/:placeId/schedule` | 将地点复制到目标日期，保留池中原地点                 |
| POST         | `/api/items/:id/move`                     | 在同一 Trip 内移动事项，保留 ID 并同步其账单日期     |

地点池字段：`title`、`type`、`placeCategory`、`amapPoiId`、`address`、`lat`、`lng`、`notes`。分类为最多 40 字符的非空文本，支持常用选项和自定义值。DayItem 新增 `sourcePlaceId` 和 `placeCategory`，用于来源关联及分类副本。

安排地点请求为 `{ dayId, beforeItemId?, expectedVersion, expectedDayVersion }`，其中 expectedVersion 是池中地点版本；省略 beforeItemId 时添加到当天末尾。

移动事项请求为 `{ dayId, beforeItemId?, expectedVersion, expectedSourceDayVersion, expectedTargetDayVersion }`。所有版本及 Trip 归属在同一事务中验证，冲突返回 409；关联费用的 dayItemId 保持不变、dayId 随事项更新。

## 成员与协作

| 方法     | 路径                                         | 行为                                                                                          |
| -------- | -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| GET      | `/api/trips/:id/members`                     | 成员列表                                                                                      |
| PATCH    | `/api/trips/:id/members/:userId`             | owner 修改 role/status，不能移除或降级 owner                                                  |
| GET/POST | `/api/trips/:id/participants`                | 同行者列表 / 添加未注册同行者                                                                 |
| PATCH    | `/api/trips/:id/participants/:participantId` | owner 改姓名或停用未注册同行者                                                                |
| DELETE   | `/api/trips/:id/participants/:participantId` | owner 删除没有费用或结算记录的未注册同行者及其专属邀请                                        |
| GET/POST | `/api/trips/:id/invites`                     | owner 查看邀请 / 创建邀请                                                                     |
| DELETE   | `/api/trips/:id/invites/:inviteId`           | owner 撤销邀请                                                                                |
| POST     | `/api/invites/:token/join`                   | 登录后原子接受邀请                                                                            |
| GET      | `/api/trips/:id/events`                      | SSE：`sync`、`change`、`revoked`；`sync` / `change` 携带 `sequence`，客户端仅在版本落后时刷新 |
| GET      | `/api/trips/:id/activity`                    | 最近 200 条活动                                                                               |
| GET/POST | `/api/trips/:id/comments`                    | 查看 / 发表纯文本评论                                                                         |

删除同行者请求为 `{ expectedVersion }`，适用于启用或停用的未注册同行者。已有付款、分摊或结算记录时返回 400 `PARTICIPANT_HAS_RECORDS`，应改用停用以保留历史账目；已绑定账号的同行者通过成员管理移出行程。删除成功后，其专属邀请同步删除并失效。

邀请输入包含 `role: editor | viewer`、可选 `participantId`、`expiresAt`、`maxUses`。默认七天、最多十次；专属邀请固定单次使用。响应中的原始 token 仅在创建时返回，列表不会包含 tokenHash。

评论目标为 `trip`、`day_item` 或 `expense`，必须属于当前 Trip。未注册参与者不获得访问权限；所有者通过专属邀请授予账号权限及原账目身份。

## 费用

| 方法         | 路径                         | 行为                          |
| ------------ | ---------------------------- | ----------------------------- |
| GET/POST     | `/api/trips/:id/expenses`    | 查看 / 创建费用               |
| PATCH/DELETE | `/api/expenses/:id`          | 修改整笔费用 / 删除并重算余额 |
| GET          | `/api/trips/:id/balances`    | `{ balances, suggestions }`   |
| POST         | `/api/trips/:id/settlements` | 登记实际转账                  |
| DELETE       | `/api/settlements/:id`       | 删除转账并重算余额            |

```json
{
  "title": "三人晚餐",
  "category": "food",
  "amountMinor": 60000,
  "currency": "HKD",
  "payerParticipantId": "participant-a",
  "exchangeRateToBase": "0.9",
  "splitMethod": "equal",
  "splitMeta": [
    { "participantId": "participant-a", "value": "1" },
    { "participantId": "participant-b", "value": "1" },
    { "participantId": "participant-c", "value": "1" }
  ],
  "incurredAt": 1790906400000
}
```

`amountMinor` 为整数最小货币单位；`splitMeta.value` 在 exact 模式为原币主单位十进制字符串，在 percentage 模式为百分数，在 shares 模式为份数，equal 模式忽略该值。服务端计算并保存每人的 `amountMinor`、`baseAmountMinor`，不接受客户端直接指定折算结果。

Settlement 使用 `fromParticipantId`、`toParticipantId`、`amountMinor`、`currency`、`exchangeRateToBase`、`settledAt`、可选 `note`。所有日期时间审计字段为 Unix 毫秒；Trip/Day 日期为 `YYYY-MM-DD`。

`POST /api/trips/:tripId/places/reorder` 保存地点池顺序，owner/editor 可用。请求为 `{ places: [{ id, expectedVersion }] }`，需包含当前地点池全部地点；重复 ID、跨行程 ID、增删或版本冲突返回 409。事务中更新位置与修改版本，并写入一条活动；已有行程事项保持独立。新地点追加到列表末尾，迁移保留原有收藏顺序。

独立交通通过事项的可空 `transport` 字段维护，包含交通类型、暂定／已确认、班次、起终点和可选时长。名称即可保存起终点；地点池来源校验 Trip 归属。出发和到达时间使用事项的 `startMinutes`、`endMinutes`。详见[地图地点与独立交通](map-and-transport.md)。

行程起止日期与 Day 数量保持一致，缩短范围时超出的日期若含事项或费用则返回 409。单独新增、删除 Day 返回 405。日历与新选择控件详见[SkyWeave 日历与规划操作](calendar-and-controls.md)。

## 页面快照与按需地图

`GET /api/trips/:id?section=...` 保留快照结构；页面不需要的集合为 `[]`，不是该集合在数据库中为空。省略 `section` 的现有 API 仍返回完整数据（包含所有候选路线坐标），供 API 和 MCP 使用。未知 `section` 返回 400。

| section  | 加载的数据（所有页面均包含行程、权限、成员、日期元数据和 sequence）      |
| -------- | ------------------------------------------------------------------------ |
| plan     | 地点池、全部事项与路线摘要/步骤、参与者、费用与分摊、评论；不含 polyline |
| view     | 全部事项与路线摘要/步骤；不含 polyline，保留行程查看和导出所需信息       |
| expenses | 事项、参与者、费用与分摊、结算、评论；不查询路线候选                     |
| members  | 参与者及 owner 可见的邀请；不查询事项、路线或账目                        |
| activity | 评论与最近 200 条动态；不查询事项、路线或账目                            |

地图通过 `GET /api/days/:id/geometry` 获取当前日期已选候选的 WGS-84 坐标。客户端按日期 ID 和 `version` 缓存，版本不匹配的坐标不会应用到当前地图。候选摘要仍保留步骤，展开路线和行程导出不会因按需地图而丢失说明。

快照的 `sequence` 与数据在同一个 SQLite 只读事务中读取。首次加载、SSE 初始化/重连共享请求；下载期间出现更高变更序号时，客户端追加刷新。切换行程标签复用共享布局中的数据和 SSE；窗口重新获得焦点或重新进入缓存页面时先检查 `/revision`，并更新不产生行程动态的成员昵称/邮箱。写操作完成后使已缓存页面失效；权限撤销清空行程缓存并取消请求。

普通 API 的成功 JSON 响应提供 `Server-Timing: app;dur=...`（单位毫秒，包含鉴权、业务读取和响应序列化，不含网络下载）与 `X-Request-Id`。部署和性能验收见 [性能说明](performance.md)。

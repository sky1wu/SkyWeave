# API 与数据约定

除健康检查和认证入口外，接口需要会话 Cookie。写入使用 JSON 和同源 Origin；更新、删除携带 `expectedVersion`。版本冲突返回 `409 CONFLICT`，不自动合并。错误格式：`{ error: { code, message }, requestId }`。

## 入口

| 方法         | 路径                  | 行为                                                                                    |
| ------------ | --------------------- | --------------------------------------------------------------------------------------- |
| GET          | `/api/health`         | 健康检查                                                                                |
| GET/POST     | `/api/auth/*`         | Better Auth：注册、登录、退出、会话                                                     |
| GET          | `/api/config`         | JS Key、地图是否配置、是否为显式测试环境；不返回服务端密钥                              |
| GET          | `/_AMapService/:path` | 已认证的 JS API 代理，固定高德主机并附加安全密钥                                        |
| GET/POST     | `/api/trips`          | 列出自己的 Trip / 创建 Trip 和第一天                                                    |
| GET          | `/api/trips/:id`      | 返回 TripSnapshot：行程、权限、Days、事项、路线候选、成员、参与者、账目、评论和最近动态 |
| PATCH/DELETE | `/api/trips/:id`      | owner 更新设置 / 删除 Trip                                                              |

## 行程与路线

| 方法             | 路径                                | 行为                                                         |
| ---------------- | ----------------------------------- | ------------------------------------------------------------ |
| POST | `/api/trips/:id/days/reorder` | `{ expectedVersion, dayIds }`，整天排序并自动分配日期 |
| GET/PATCH | `/api/days/:id` | 当天快照 / 修改开始时间；日期与天数由 Trip 设置维护 |
| POST             | `/api/days/:id/items`               | 添加事项                                                     |
| PATCH/DELETE     | `/api/items/:id`                    | 修改 / 删除事项并维护路线关系                                |
| POST             | `/api/days/:id/reorder`             | `{ expectedVersion, itemIds }`，必须完整包含当天事项且无重复 |
| PATCH            | `/api/legs/:id`                     | 更新交通方式、手动时长或已保存候选选择                       |
| POST             | `/api/legs/:id/route`               | 查询并保存候选，返回更新后的 Leg 和 alternatives             |
| POST             | `/api/days/:id/routes/recalculate`  | 向后重新计算受影响路段；`{ force: true }` 可刷新已计算的段   |
| POST             | `/api/routes`                       | 不落库的统一路线查询，返回 `{ alternatives }`                |
| GET              | `/api/places/search?q=&city=`       | 高德 POI 搜索，返回 `{ places }`                             |
| GET              | `/api/places/autocomplete?q=&city=` | 高德输入提示，返回 `{ places }`                              |
| GET              | `/api/places/:amapId`               | POI 详情                                                     |

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

| 方法     | 路径                                         | 行为                                                   |
| -------- | -------------------------------------------- | ------------------------------------------------------ |
| GET      | `/api/trips/:id/members`                     | 成员列表                                               |
| PATCH    | `/api/trips/:id/members/:userId`             | owner 修改 role/status，不能移除或降级 owner           |
| GET/POST | `/api/trips/:id/participants`                | 同行者列表 / 添加未注册同行者                          |
| PATCH    | `/api/trips/:id/participants/:participantId` | owner 改姓名或停用未注册同行者                         |
| GET/POST | `/api/trips/:id/invites`                     | owner 查看邀请 / 创建邀请                              |
| DELETE   | `/api/trips/:id/invites/:inviteId`           | owner 撤销邀请                                         |
| POST     | `/api/invites/:token/join`                   | 登录后原子接受邀请                                     |
| GET      | `/api/trips/:id/events`                      | SSE：`sync`、`change`、`revoked`；重连后客户端取新快照 |
| GET      | `/api/trips/:id/activity`                    | 最近 200 条活动                                        |
| GET/POST | `/api/trips/:id/comments`                    | 查看 / 发表纯文本评论                                  |

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

# Agent 通过 MCP 读写日程与费用

应用提供 `/api/mcp`，使用官方 [TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/server) 的 Streamable HTTP 传输。接口随应用启动，无需额外进程或全局密钥。

## 连接

1. 登录应用，进入「用户设置 → Agent 访问 · MCP」。
2. 创建令牌，选择单个行程或所有可访问行程、只读或读写、有效期（默认 30 天，最多 365 天）。
3. 保存只显示一次的令牌。在 Agent 的 MCP 连接中填写页面显示的地址，例如 `https://trip.example.com/api/mcp`，传输选择 **Streamable HTTP**，认证使用 **Bearer Token**。
4. 先调用 `list_trips`，再读取日程或费用。写入后使用响应中的新版本继续操作。

支持 `url` 和 `headers` 配置的客户端可使用以下形式；具体字段以客户端为准：

```json
{
  "mcpServers": {
    "skyweave": {
      "url": "https://trip.example.com/api/mcp",
      "headers": {
        "Authorization": "Bearer <在用户设置中创建的令牌>"
      }
    }
  }
}
```

官方 SDK 客户端示例（令牌放在运行环境中）：

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "travel-agent", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(process.env.SKYWEAVE_MCP_URL!), {
    requestInit: {
      headers: { Authorization: `Bearer ${process.env.SKYWEAVE_MCP_TOKEN}` },
    },
  }),
);
try {
  const trips = await client.callTool({ name: "list_trips", arguments: {} });
  console.log(trips.structuredContent);
} finally {
  await client.close();
}
```

服务采用无状态 JSON 响应，每次请求重新认证，不依赖 MCP 会话 ID。`GET` / `DELETE` 返回 405，通知返回 202。此版本使用手动签发的个人访问令牌，不提供 OAuth 登录发现或旧版 HTTP+SSE 入口；客户端须支持配置 Authorization 请求头。

## 日程工具

除 `list_trips` 外，所有工具都必须传入 `tripId`。`tools/list` 提供完整 JSON Schema、字段说明及读写/删除提示。

| 工具                 | 用途                                                  |
| -------------------- | ----------------------------------------------------- |
| `list_trips`         | 列出令牌范围内仍有访问权限的行程及角色                |
| `get_itinerary`      | 行程设置、全部日期、事项、路线、推算时间线及地点池    |
| `get_day`            | 单天日程及时间线，传 `dayId`                          |
| `update_trip`        | owner 修改名称、日期范围、时区；自动维护天数          |
| `update_day`         | 修改当天开始分钟                                      |
| `create_item`        | 向当天末尾新增事项，传 `item` 和 `expectedDayVersion` |
| `update_item`        | 用 `changes` 局部修改事项，支持固定活动和独立交通     |
| `delete_item`        | 删除事项，保留费用并解除事项关联                      |
| `reorder_items`      | 用完整 `itemIds` 列表排序当天事项                     |
| `move_item`          | 同一行程内移动事项，保留 ID 并同步账单日期            |
| `reorder_days`       | 用完整 `dayIds` 列表移动整天内容并调整日期            |
| `update_leg`         | 修改交通方式、手动段信息或路线候选                    |
| `recalculate_routes` | 查询并保存当天高德路线，`force` 可强制刷新            |
| `search_places`      | 按 `query` 和可选 `city` 搜索高德地点                 |
| `save_place`         | 通过 `place` 收藏到地点池                             |
| `schedule_place`     | 复制收藏地点到某天，保留原收藏                        |

时间使用行程时区中相对当天零点的分钟数，例如 09:00 为 540，次日 01:00 为 1500。坐标使用 WGS-84。事项变更会维护相邻路段；随后调用 `recalculate_routes` 更新路线候选，并检查每条 `day.legs` 的 `status` / `error`。高德服务未配置或查询失败会返回实际错误信息。

`get_itinerary.days` 中每个元素为 `{ day, timeline }`，其中 `day` 包含事项、路线和各实体版本。日程读取不返回成员邮箱、邀请、费用或评论；费用通过专用工具读取。

## 费用工具

| 工具                | 用途                                                         |
| ------------------- | ------------------------------------------------------------ |
| `get_expenses`      | 费用与分摊明细、参与者、结算记录、余额、建议转账及币种小数位 |
| `get_balances`      | 读取结算币种、每人余额和建议转账                             |
| `create_expense`    | 通过 `expense` 创建费用并计算分摊                            |
| `update_expense`    | 通过 `expenseId`、`expectedVersion` 和 `expense` 更新费用    |
| `delete_expense`    | 删除费用及其分摊、评论，并重算余额                           |
| `create_settlement` | 通过 `settlement` 登记已完成的实际转账                       |
| `delete_settlement` | 撤销结算记录并恢复余额                                       |

先读取 `get_expenses`，使用返回的 **participantId** 作为付款人、分摊人和结算双方，不能使用用户 ID。参与者仍在应用成员页管理。

`amountMinor` 为整数最小货币单位，CNY 12.34 元填 1234，JPY 123 日元填 123；`currencies[].minorDigits` 提供小数位。`exchangeRateToBase` 是原币兑换行程结算币的十进制字符串，同币种为 `"1"`。`incurredAt`、`settledAt` 使用 Unix 毫秒。

新增费用调用示例：

```json
{
  "name": "create_expense",
  "arguments": {
    "tripId": "<行程 ID>",
    "expense": {
      "title": "两人晚餐",
      "category": "food",
      "amountMinor": 20000,
      "currency": "HKD",
      "exchangeRateToBase": "0.9",
      "payerParticipantId": "<付款人 participantId>",
      "splitMethod": "equal",
      "splitMeta": [
        { "participantId": "<参与者 A>", "value": "1" },
        { "participantId": "<参与者 B>", "value": "1" }
      ],
      "incurredAt": 1790906400000
    }
  }
}
```

示例汇率仅演示字段格式，使用时传入用户确认的实际汇率。`splitMethod` 支持 `equal`、`exact`、`percentage`、`shares`；`splitMeta.value` 分别为 `"1"`、原币主单位金额、百分数、份数。`dayId` / `dayItemId` 可关联日期和事项。

更新费用时必须提供全部必填输入字段；可选字段省略时保留，传 `null` 清空。不要把读取结果中的 `id`、`version`、`splits`、折算金额等只读字段放进 `expense`。费用和结算新增操作不幂等；请求结果不确定时应先读取记录核对，避免重复记账。

结算工具只登记或撤销应用内记录，不发起银行支付。用户确认转账已完成后才调用 `create_settlement`。

## 权限与并发

- 令牌绑定账号，可限定单个行程；只读/读写同时覆盖日程与费用。读写令牌不能提升角色：viewer 仍不可写，编辑行程设置仍需 owner。
- 服务端仅保存令牌 SHA-256 摘要、前缀和元数据，完整令牌只在创建时返回。每个账号最多 20 个未过期令牌。撤销后下个请求即失效；删除限定行程会同时删除令牌。
- 移除成员或降低角色后，下一次工具调用立即受新权限约束。登录 Cookie 不能访问 MCP；MCP 令牌也不能用于账号设置、令牌管理或其他 REST 接口。
- 更新/删除携带目标实体的 `expectedVersion`；事项新增带 `expectedDayVersion`，跨日移动还带源/目标 Day 版本，安排收藏地点带地点与目标 Day 版本。校验和写入在事务内完成。
- 参数或业务错误通过 MCP `isError: true` 返回；业务错误含 `structuredContent.error.{code,message,status}`。`CONFLICT` 表示内容已变化，重新读取并核对修改意图后再提交。
- 写入复用现有事务、活动记录和 SSE 通知，浏览器会同步变化。工具不会管理账号、成员、邀请或删除整个行程。

令牌管理 REST 接口为 `GET/POST /api/mcp-tokens` 和 `DELETE /api/mcp-tokens/:id`，需要网页登录会话；写入还需同源 Origin 和 JSON。创建参数：`{ name, permission: "read" | "edit", tripId: string | null, expiresInDays: 1..365 }`；删除请求体为 `{}`。

远程使用时配置正确的 `BETTER_AUTH_URL`，通过 HTTPS 连接，并让反向代理保留 Authorization 请求头。带 Origin 的 MCP 请求仅接受该配置地址的 Origin；普通 Agent 请求可不带 Origin。

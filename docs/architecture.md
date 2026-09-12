# v0.1 设计决策

完整实现任务书更新范围；不采用旧版不含认证/协作的范围。

- Next.js 16 / React / TypeScript strict / Tailwind / SQLite / Drizzle / Better Auth / REST + SSE。
- 邮箱密码登录；owner/editor 可编辑行程、费用和结算，owner 管理成员，viewer 可读和评论。
- TripParticipant 独立于 TripMember，未注册同行者通过一次性专属邀请绑定账号，历史账目 ID 不变。
- 金额为整数 minor units，汇率为十进制字符串；原币和结算币分摊分别守恒；首次记账后锁定基础币种。
- DayItem 时间为相对 Day 午夜的分钟偏移，支持次日；固定活动不因迟到延后结束，note 不阻断路线。
- WGS-84 坐标对象 lat/lng，polyline [lng, lat]；只在高德边界转换。
- 自动重算 debounce 500ms；保留所有有效候选和用户选择，过期响应不覆盖新版本。
- 业务 mutation、版本校验和 Activity Log 同事务；SSE 通知后重新获取数据。

## 数据库

认证：users / sessions / accounts / verifications；Agent 令牌：mcp_tokens（只保存摘要，绑定用户与可选行程范围）。
协作：trips / trip_members / trip_participants / trip_invites。
规划：trip_places / days / day_items / travel_legs / route_alternatives。
账目：expenses / expense_splits / settlements。
交流：comments / activity_logs。

费用付款人、分摊人和结算双方使用 participantId；操作人使用 userId。所有关联校验 Trip 归属。移除成员保留参与者，删除事项解除费用关联。SQLite 外键、WAL、busy timeout；生成式迁移在启动时运行。

## 地点池与连续时间线

Trip 级地点池独立于 DayItem，保存分类和地点资料。拖入时复制为当天事项并记录 sourcePlaceId，原地点保留；重复用于其他日期时创建新的事项。分类初始继承，之后可分别编辑。

全部 Day 连续呈现在同一个滚动区域中，搜索位于独立的固定面板。点击日期与用户滚动分别处理，异步保存不覆盖后续导航。展开交通段以两端和当前 polyline 调整地图范围。

跨日移动保留 Item ID、评论及 Expense 关联，原日和目标日的顺序、TravelLeg 与版本在同一事务中维护。

## 路线数据流

DayItem 变更 → 事务更新相邻 TravelLeg → 客户端触发当天重算 → 按推算出发时间查询高德 → WGS-84 候选落库 → 更新选择 → 纯函数推算时间线 → 地图显示选择的路线。网络请求在数据库事务外进行，落库前检查 Day/Leg 版本。

## 页面与目录

/ 行程列表；/login；/register；/invite/:token；/trips/:id/plan、expenses、members、activity。
src/app 页面和 Route Handler；src/components 界面；src/domain 纯函数与类型；src/server 数据与服务；src/geo 坐标；src/amap 高德；tests、e2e、drizzle、docs。

`/api/mcp` 使用官方 MCP SDK 的无状态 Streamable HTTP。每个请求验证个人令牌，工具层检查令牌范围、实体行程归属，并复用 service / places / routing 的权限、事务和版本检查。日程与费用使用独立读取工具，写入进入原有活动记录与 SSE 同步流程。配置和工具约定见 [MCP 接口](mcp.md)。

## 实施顺序

1. 初始化与配置
2. 数据库/认证/行程/成员/邀请
3. Day/Item/并发/活动
4. 高德/POI/路线候选
5. 时间线/地图/编辑交互
6. 费用/分摊/结算
7. SSE/评论/协作
8. E2E/Docker/交付文档

每个独立功能增量检查后提交；真实 Key 与数据库永不提交。

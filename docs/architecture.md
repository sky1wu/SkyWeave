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

认证：users / sessions / accounts / verifications。
协作：trips / trip_members / trip_participants / trip_invites。
规划：days / day_items / travel_legs / route_alternatives。
账目：expenses / expense_splits / settlements。
交流：comments / activity_logs。

费用付款人、分摊人和结算双方使用 participantId；操作人使用 userId。所有关联校验 Trip 归属。移除成员保留参与者，删除事项解除费用关联。SQLite 外键、WAL、busy timeout；生成式迁移在启动时运行。

## 路线数据流

DayItem 变更 → 事务更新相邻 TravelLeg → 客户端触发当天重算 → 按推算出发时间查询高德 → WGS-84 候选落库 → 更新选择 → 纯函数推算时间线 → 地图显示选择的路线。网络请求在数据库事务外进行，落库前检查 Day/Leg 版本。

## 页面与目录

/ 行程列表；/login；/register；/invite/:token；/trips/:id/plan、expenses、members、activity。
src/app 页面和 Route Handler；src/components 界面；src/domain 纯函数与类型；src/server 数据与服务；src/geo 坐标；src/amap 高德；tests、e2e、drizzle、docs。

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

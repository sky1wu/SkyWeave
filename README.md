# SkyWeave

基于高德地图的旅行规划与费用分摊工具。

面向中国大陆、香港和澳门旅行的自托管应用。以地图和每日时间线组织行程，支持高德地点搜索、每段独立交通方式、公交多候选、手动过关段、固定活动提醒、多人协作和多币种费用结算。

## 启动

需要 Node.js 22+、npm，或 Docker Compose。

首次配置：复制 `.env.example` 为 `.env.local`，填写高德 **Web服务 Key**、**Web端 JS Key** 和 JS 安全密钥。当前工作目录已创建 `.env.local`，直接编辑即可。认证密钥请使用随机值；Docker 在未配置时自动生成并保存到数据卷。

```sh
docker compose up -d --build
```

访问 <http://localhost:3000>，注册账号并创建行程。初始数据库为空，测试场景不会自动进入你的行程。

本地开发：

```sh
npm ci
npm run dev
```

本地生产运行：

```sh
npm run build
npm start
```

`npm start` 会整理 Next.js standalone 运行目录，数据库仍保存在项目的 `data/`。构建先串行执行数据库迁移，再启动 Next.js 构建，避免多个构建进程重复迁移。应用初始化时也会执行迁移，可单独运行 `npm run db:migrate`。

## 配置

| 环境变量               | 用途                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `AMAP_WEB_SERVICE_KEY` | 服务端调用高德 POI、路线和逆地理编码；不发送给浏览器                                |
| `AMAP_JS_KEY`          | 浏览器加载高德 JS API 2.0，从服务端运行时配置获取                                   |
| `AMAP_SECURITY_CODE`   | JS 安全密钥，由应用内 `/_AMapService` 代理附加                                      |
| `BETTER_AUTH_SECRET`   | 认证密钥；当前本地配置已生成；Docker 可自动生成并持久保存                           |
| `BETTER_AUTH_URL`      | 用户访问应用的完整地址，默认 `http://localhost:3000`                                |
| `DATABASE_PATH`        | 本地默认 `./data/trip-planner.sqlite`；Compose 固定 `/app/data/trip-planner.sqlite` |
| `PORT`                 | 本地生产服务及 Compose 宿主机端口，默认 3000                                        |
| `APP_HOST`             | 本地生产服务监听地址，默认 `0.0.0.0`                                                |

向朋友提供访问时，把 `BETTER_AUTH_URL` 改成实际的域名或局域网地址，并在高德控制台配置相应 JS Key 域名。修改环境变量后重启服务；同一 Docker 镜像可以复用于不同 Key。

`AMAP_TEST_MODE=1` 仅用于明确启用的隔离测试，Compose 将它固定为 `0`。缺少 Key 时应用显示服务未配置，不会自动返回模拟地点或路线。

## 使用

1. 创建 Trip，设置日期、时区和结算币种。天数与起止日期联动，保存后自动生成对应日期。拖动“第 x 天”可移动整天内容并自动调整日期；缩短范围前需先整理超出日期的事项与账单。
2. 地图上的行程和地点池是可独立折叠的悬浮面板。在地点池固定搜索区搜索，点击结果收藏到地点池。城市和地点分类使用可搜索下拉，分类还支持自定义。按分类整理，再拖入任意一天、任意事项之前；也可点击“加入第 N 天”。地点池保留原地点并显示安排次数。
3. 未安排地点也显示在地图上，名称常驻，按分类显示图标。点击标记可定位地点池卡片。时间线连续显示全部日期，上下滚动衔接前后天，顶部日期和地图随当前天切换。地点池和时间线均支持整卡拖动，地点池排序也会保存。“全部折叠”可切换为只有名称的排序视图。手机长按拖动，普通滑动滚动；支持跨日移动、`Alt + ↑/↓` 和菜单操作。
4. 展开或修改交通段时，地图自动定位到两端及所选路线，并避开悬浮面板。行程变更后自动计算路线，可更换步行、驾车、骑行、公交或手动方式并切换候选。展开区顶部和底部均可收起。
5. 固定活动填开始及结束时间。交通段和事项上显示预计到达时间，以及到达后距开始还剩多久或预计迟到多久；跨午夜选择“次日”。
6. 每天标题旁的“交通”可添加火车、飞机、长途汽车和轮船；起终点只填城市也能保存，班次、时间和具体地点可后补。高德仅计算前后接驳，独立交通用虚线示意。
7. 在成员页添加尚未注册的同行者，或创建邀请。专属邀请会将注册账号绑定到原同行者，保留其费用和结算身份。
8. 在事项上点击“记一笔”，关联账单会直接显示在事项下方；跨日移动事项时，账单关联一并跟随。转账完成后在费用页登记实际结算。

owner 管理成员、邀请及 Trip 设置；owner/editor 可编辑行程、费用和结算；viewer 只读并可评论。成员移出后撤销访问，历史账目仍保留。

## 验证与文档

```sh
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run smoke:amap
```

E2E 使用独立的临时 SQLite 和显式测试 provider，自动启动生产服务，不会写入你的数据库。真实高德联调脚本使用本地 Key，报告保存于 `.tmp/live-amap-results.json`，不包含密钥。

- [架构、数据流及目录](docs/architecture.md)
- [数据库字段与索引](src/server/schema.ts)，[初始迁移](drizzle/0000_bouncy_stryfe.sql)
- [API 与数据约定](docs/api.md)
- [地点池与连续规划](docs/planner-update.md)
- [悬浮面板、卡片交互与界面预览](docs/ui-style.md)
- [地图地点与独立交通](docs/map-and-transport.md)
- [日历、精简排序与选择控件](docs/calendar-and-controls.md)
- [城市漫游手册设计系统与组件](docs/design-system.md)
- [算法、坐标和高德接入](docs/algorithms.md)
- [验收结果](docs/validation.md)
- [范围依据](docs/task-spec.md)
- [第三方数据来源](THIRD_PARTY_NOTICES.md)

## 部署与备份

Compose 使用单个应用容器和 `trip-data` 数据卷，应用以非 root 用户运行。费用、邀请、会话及路线候选都存入 SQLite，重启后继续保留。`/api/health` 用于健康检查。

更新时重新执行 `docker compose up -d --build`。正常停止/重启不会删除数据卷；`docker compose down -v` 会删除数据，不能用于日常更新。

备份可使用 SQLite 在线备份接口：

```sh
docker compose exec app node -e "const D=require('better-sqlite3');new D('/app/data/trip-planner.sqlite').backup('/app/data/backup.sqlite').then(()=>console.log('backup complete'))"
docker compose cp app:/app/data/backup.sqlite ./backup.sqlite
```

同时保管 `.env.local`，以及 Docker 自动生成认证密钥时的数据卷内 `auth-secret`。恢复数据库前先停止应用；替换数据文件后确认容器用户有读写权限。

反向代理需关闭 SSE 缓冲，并允许持续连接，例如 Nginx 为 `/api/trips/` 设置 `proxy_buffering off`、`proxy_read_timeout 60s`。应用每 15 秒发送心跳。公网部署在反向代理处提供 HTTPS，应用地址与认证地址保持一致。

## 已知限制与 v0.2

- 单进程、单 SQLite 实例；SSE 通过活动序号通知并重新获取 Trip 快照，适合朋友小组，暂不支持多实例扩展或字段级自动合并。
- 动态页面显示最近 200 条活动；没有完整审计恢复、邮件通知、邮件验证或邮件找回密码流程。
- 支持 CNY、HKD、MOP、USD、JPY、TWD、EUR、GBP、KRW、SGD，汇率手填并逐笔锁定；退款可通过修改原费用反映，尚无独立退款单据。
- 高德候选、时长和可用路线随查询时间变化。相邻景点可能没有公交方案；过关等场景使用明确的手动段。缺几何的有效候选保留时间信息，不伪造道路连线。
- 坐标转换区域沿用上游近似地理边界；数值回归不等于测绘精度。香港、澳门及台湾已做实际 POI 接口核对，西安和香港完成真实底图视觉检查。
- 同一 Day 可以跨午夜，首版不自动连接不同 Day 的最后与第一个事项。
- v0.2 可增加活动分页、按实体局部刷新、邀请身份手动合并、密码恢复、可选自动汇率、独立退款、导入导出及更多币种。AI、票务和导航仍需单独确定范围。

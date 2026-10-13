# 嘉安月嫂社区助就业·养老服务活动签到系统

沿用原版粉色签到页面。前端和 Node.js 后端使用同一个网址，签到写入现有飞书多维表格；管理员在手机后台查看人数、全部名单、项目统计。

## 先看这里

- 签到页：`https://你的域名/`
- 手机后台：`https://你的域名/admin.html`
- 不需要另建数据库，不需要重新创建飞书表格。
- 本项目交付时未填写 App ID / App Secret，未完成真实云端部署。测试通过表示模拟飞书调用和项目功能已验证，不等于已写入你的真实表格。
- `FEISHU_APP_TOKEN` 和 `FEISHU_TABLE_ID` 已按现有表格填写在 `.env.example`。请把应用凭证填写在部署平台的私密环境变量中。

## 项目目录

```text
jiaan-signin/
  server.js           Node / Render / Vercel 入口
  src/                飞书调用、接口与后台登录
  public/             原版粉色签到页面和手机后台
  test/               接口与飞书调用的自动化测试
  package.json
  package-lock.json
  .env.example        配置模板，包含现有表格标识
  render.yaml         Render 部署配置
  vercel.json         Vercel 部署配置
  README.md
```

## 环境变量

在 Render 或 Vercel 的 Environment Variables 中逐项添加；变量名称必须完全一致。

| 名称 | 填写内容 |
| --- | --- |
| `FEISHU_APP_ID` | 你已创建应用的 App ID |
| `FEISHU_APP_SECRET` | 同一应用的 App Secret |
| `FEISHU_APP_TOKEN` | `SwoobWgjJaURClsBcsgcfSIhnde` |
| `FEISHU_TABLE_ID` | `tbldG1LXQYkP63cB` |
| `ADMIN_PASSWORD` | 自己设置的后台密码，至少 12 个字符 |
| `NODE_ENV` | `production` |

App Secret、后台密码不要放进 HTML、GitHub 仓库、二维码网址或聊天记录。平台会提供 `PORT`，云端无需自行填写。

## 保留现有表格

程序按现有字段名称写入：姓名、联系电话、签到人员、参与项目、签到时间；备注保留，不自动填入。

| 字段名称 | 程序支持的字段类型 |
| --- | --- |
| 姓名 | 文本 |
| 联系电话 | 文本或电话号码；不要用数字，避免号码格式变化 |
| 签到人员 | 文本、单选或多选，表示身份类别 |
| 参与项目 | 文本、单选或多选 |
| 签到时间 | 日期，自动写入毫秒时间戳 |

「签到人员」的值是社区居民、求职人员等类别。飞书的「人员」字段用于飞书账号成员，不能直接写这些类别。程序会读取字段信息确认格式，遇到不匹配会显示明确错误，不会报告假成功。

名单和人数统计包含此数据表的全部记录，不自动按活动日期筛选或按联系电话去重。如果表中已有往期数据，也会计入；请在活动前确认现有数据是否需要保留或另行筛选。

## Render 部署（当前使用的平台）

Render 的这个流程需要读取 GitHub 仓库，不是把 ZIP 直接上传到 Render。

1. 本次使用现有仓库 `Yj-19408/jiaan-platform`，项目放在 `jiaan-signin` 文件夹中，保留原仓库内容。自行上传时把解压后的整个 `jiaan-signin` 文件夹拖到 GitHub 上传页面，不要上传 `.env` 或 `node_modules`。
2. 在 Render 选择 **New → Web Service**，选择该仓库；如需要连接 GitHub，按页面提示登录并授权这个仓库。
3. 选择 **Node**，填写以下内容：

   | 配置项 | 值 |
   | --- | --- |
   | Name | `jiaan-community-signin`（可自行修改） |
   | Root Directory | `jiaan-signin`（本次现有仓库的项目子目录） |
   | Build Command | `npm ci` |
   | Start Command | `npm start` |
   | Health Check Path | `/health` |

4. 在 **Environment Variables** 添加上面的 6 项变量。先不要把密码或 Secret 直接写入构建命令。
5. 选择实例方案后点击 **Deploy Web Service**。如果选择付费方案，先确认页面显示的费用。
6. 页面状态显示 **Live** 后，打开 Render 提供的 `https://...onrender.com`，这是签到网址。
7. 同一个网址后加 `/admin.html`，输入 `ADMIN_PASSWORD` 登录手机后台。

也可以在仓库上传完成后使用 Render 的 Blueprint 导入配置；子目录版本请使用仓库根目录的 `render.yaml`，它指向 `jiaan-signin`。ZIP 中的 `render.yaml` 是独立项目根目录配置。

Render 免费 Web Service 闲置 15 分钟会休眠，下次打开可能等待约一分钟。请活动开始前用手机打开并实测；对现场即时响应有要求时使用持续运行的方案。参考 [Render 部署说明](https://render.com/docs/deploy-node-express-app) 和 [免费实例说明](https://render.com/docs/free)。

## Vercel 部署（备用）

1. 在 Vercel 选择 **Add New → Project**，导入同一个 GitHub 仓库。
2. 根目录选择包含 `package.json` 的目录，框架使用 **Express**；本项目没有前端构建步骤，不要填写静态网站输出目录。
3. 添加上述环境变量，确保包含 **Production**；如果要测试预览部署，也给 Preview 添加对应变量。
4. 点击 **Deploy**，完成后打开 `https://...vercel.app`。后台地址同样是 `/admin.html`。
5. 修改环境变量后需要重新部署，使新值生效。

项目采用 Vercel 原生 Express 入口，`public` 文件由平台提供。参考 [Vercel Express 官方说明](https://vercel.com/docs/frameworks/backend/express)。

分页代码不设置总条数上限，但读取全部数据仍受平台执行时间和飞书接口响应速度影响。任何一页失败都会返回错误，不能把部分数据当成完整名单。社区活动规模可正常分页读取；极大量历史数据建议在持续运行的服务上使用，并进行容量验证。

## 部署后验收与二维码

1. 用手机移动网络打开正式签到网址，确认原粉色页面显示正常。
2. 填写一条能识别的测试签到，确认页面显示「签到成功」，并在现有飞书表格中核对姓名、电话、类别、项目和签到时间。
3. 用手机打开后台，登录后核对人数、名单和项目统计；切换名单页检查较后记录可见。
4. 将**正式签到网址**制作成二维码并打印。不要使用 localhost、后台地址或临时预览网址。
5. 从另一台手机扫码，再测试一次，确认现场可用后再批量打印。

提交请求携带 UUID v4 幂等标识。相同内容遇到网络中断后重试会复用标识，减少重复写入；修改表单内容会使用新标识。这不是按手机号禁止重复签到。页面提示写入结果未知时，可以先在后台核对。

## 手机后台

- 显示全部记录的签到人数与参与项目统计。
- 查询全部飞书记录，名单在手机上分批展示，翻页可以查看全部数据。
- 提供手动刷新，页面可见时每 20 秒自动刷新。
- 后台接口需要登录，未登录不能读取姓名或电话号码。
- 登录会话保存在 HttpOnly Cookie，密码不存入浏览器本地存储。
- 退出登录或登录过期后重新输入密码。

## 本地运行

先安装 Node.js 22 或更新的受支持版本，在项目目录运行：

```powershell
npm ci
Copy-Item .env.example .env
# 在 .env 中填写 App ID、App Secret 与后台密码
npm start
```

打开 `http://localhost:3000`；后台打开 `http://localhost:3000/admin.html`。本地测试运行 `npm test`，使用模拟飞书响应，不会给真实表格添加测试数据。

## 接口说明

| 接口 | 用途 | 是否需要后台登录 |
| --- | --- | --- |
| `POST /api/sign` | 提交四项信息并写入飞书 | 否 |
| `GET /api/list` | 自动分页、合并并返回全部签到记录 | 是 |
| `GET /api/count` | 按全部记录计算人数 | 是 |
| `GET /api/stats` | 全部记录的人数、项目、人员类别统计 | 是 |
| `POST /api/admin/login` | 后台登录 | 否 |
| `POST /api/admin/logout` | 后台退出 | 否 |
| `GET /api/admin/session` | 检查登录状态 | 是 |
| `GET /api/admin/connection` | 检查配置和字段是否能读取 | 是 |
| `GET /health` | 服务运行检查 | 否 |

`GET /api/list` 成功返回 `{success:true,items:[全部记录],total:记录数}`。飞书每页最多 500 条；当 `has_more=true` 时携带 `page_token` 继续请求，直到结束。没有「只取前 100 条」或其他固定总条数限制。后端会缓存 tenant_access_token，并在失效时重新获取。

## 常见问题

- **页面能打开，但不能签到**：检查四个飞书变量是否来自同一个应用和表格、App Secret 是否复制完整。后台配置检查与错误提示可以帮助定位。
- **有字段格式错误**：按错误提示核对当前字段类型和名称；不要另建表格。字段列表读取权限也需要在已配置应用中生效。
- **后台登录不了**：`ADMIN_PASSWORD` 至少 12 个字符。检查平台变量是否已保存并重新部署，云端通过 HTTPS 打开。
- **人数出现错误或刷新失败**：不要把错误当成零人。程序不会静默返回前几页；等待网络恢复后刷新。
- **旧版目录部署后找不到页面**：本项目已把 `public` 与根目录入口整合；平台根目录要指向包含 `package.json` 的位置。

飞书接口参考：[Token](https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal)、[新增记录及幂等标识](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/create)、[分页查询记录](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/bitable-v1/app-table-record/search)。

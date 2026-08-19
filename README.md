# 校园就业智能匹配与就业攻坚管理系统（网页版 H5）

零依赖（纯 Node 内置模块）的全栈应用，覆盖「智能画像 → 自动匹配 → 双向推荐 → 跟进签约 → 数据看板」全流程。开箱即用，无需 `npm install`。

## 本地运行
```bash
cd app
node server.js
# 浏览器打开 http://localhost:3000
```

## 角色与演示账号
登录页选择身份后输入姓名即可进入。可用**种子数据**中的姓名直接登录体验：
- 学生：张明 / 李雪 / 王浩 / 陈静 / 刘洋 / 赵琳
- 企业/HR：云启科技 / 锐进金融 / 优创快消
- 辅导员 / 管理者：任意姓名

辅导员首页点击「运行智能匹配」即可生成推荐并双向推送；学生/企业收到推荐后反馈；辅导员在「跟进管理」更新面试与签约；管理者看板查看实时指标与风险。

## 公网部署（让同学老师随时随地访问）
### 方式一：Render 免费托管（推荐，链接永久有效）
1. 将 `app/` 目录推送到你的 GitHub 仓库。
2. 打开 https://render.com → New → Web Service → 关联仓库。
3. 选择本目录，Render 会自动读取 `render.yaml` 与 `Procfile`；确认 Start Command 为 `node server.js`。
4. 部署完成后获得 `https://xxx.onrender.com` 永久公网链接，分享给同学老师即可。

### 方式二：临时公网链接（无需账号，适合演示）
在本机运行：
```bash
# 先启动服务
node server.js
# 另开一个终端，做内网穿透（任选其一）
npx localtunnel --port 3000        # 免费，无需账号，返回 https 公网地址
# 或
npx cloudflared tunnel --url http://localhost:3000
```
> 注意：临时链接依赖本机开机与进程运行，关机即失效，仅适合现场演示。

## 目录结构
```
app/
├── server.js        # 零依赖 HTTP 服务 + REST API + 静态资源
├── db.js            # JSON 文件数据层（含种子数据）
├── matcher.js       # 标准化匹配度计算模型
├── data.json        # 运行期自动生成的数据文件
├── package.json
├── Procfile / render.yaml  # 公网部署配置
└── public/          # 前端 SPA（HTML/CSS/JS，移动端优先）
```

## API 概览
- `POST /api/login` 登录/角色
- `GET/POST /api/students|enterprises|positions` 数据增查
- `POST /api/match` 运行智能匹配（生成推荐 + 双向推送）
- `GET /api/recommendations?role=&studentId=/enterpriseId=` 推荐列表
- `POST /api/recommendations/:id/feedback` 双向反馈（学生/企业）
- `POST /api/recommendations/:id/followup` 面试/签约跟进
- `GET /api/dashboard` 看板指标、转化漏斗、企业排行、风险标记
- `POST /api/reset` 重置演示数据

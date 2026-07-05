# 后端文档

## 1. 项目概述

后端是 `radio-association` 的信息与招新管理系统的服务端部分，采用 **Bun + Express + SQLite** 技术栈。

主要职责：
- 提供协会信息、部门、竞赛、培训、荣誉等公开数据的 REST API
- 接收在线报名数据并持久化到 SQLite
- 提供管理员登录、JWT 认证、报名管理接口

---

## 2. 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Bun 1.x（使用 `bun:sqlite`，无法直接在 Node.js 运行） |
| Web 框架 | Express 4.18 |
| 数据库 | SQLite 3，通过 `bun:sqlite` 访问 |
| 认证 | JWT（`jsonwebtoken`）+ bcrypt 密码哈希 |
| 环境配置 | `dotenv`（读取 `.env`） |

---

## 3. 目录结构

```
server/
├── app.js              # Express 入口：中间件、路由挂载、静态服务
├── initDB.js           # 数据库初始化/种子脚本（会清空静态表并重填）
├── config/
│   └── database.js     # SQLite 连接、建表、WAL/外键配置
├── models/             # 数据模型层：原始 SQL 查询封装
│   ├── Association.js
│   ├── Competition.js
│   ├── Department.js
│   ├── Honor.js
│   ├── Registration.js
│   └── Training.js
├── routes/             # Express 路由层
│   ├── admin.js
│   ├── association.js
│   ├── competitions.js
│   ├── departments.js
│   ├── honors.js
│   ├── registration.js
│   └── trainings.js
└── data/
    └── database.sqlite # SQLite 数据库文件（gitignored）
```

---

## 4. 启动与常用命令

```bash
# 安装依赖
bun install

# 初始化数据库（会重置 departments / competitions / honors / trainings / association 表数据）
bun server/initDB.js

# 生产启动
bun server/app.js

# 热重载开发
bun --hot server/app.js
```

服务默认监听 `http://localhost:5000`（`PORT` 环境变量可覆盖）。

---

## 5. 整体架构与数据流

```
HTTP 请求
   │
   ▼
server/app.js
   │  ├── body-parser 解析 JSON/URL-encoded
   │  ├── express.static 托管 public/ 静态资源
   │  └── /api/* 路由挂载
   ▼
server/routes/*.js
   │  ├── 公开路由：直接返回数据
   │  └── 受保护路由：先验证 JWT
   ▼
server/models/*.js
   │  原始 SQL 查询（bun:sqlite）
   ▼
server/data/database.sqlite
```

- 数据库连接是单例：所有模型通过 `require('../config/database')` 共享同一个 `Database` 实例。
- `bun:sqlite` 是同步 API，所以模型层没有异步操作；路由层写成 `async` 主要是为了兼容 `bcrypt` 和 `jwt` 的异步方法。

---

## 6. 数据库配置

### 6.1 连接文件：`server/config/database.js`

```js
const { Database } = require('bun:sqlite');
const db = new Database(path.join(__dirname, '../data/database.sqlite'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
```

- 数据库文件位置：`server/data/database.sqlite`
- 启用 WAL 模式和 foreign keys
- 首次启动时自动建表（如果表不存在）

### 6.2 表结构

| 表名 | 说明 | 备注 |
|------|------|------|
| `association` | 协会基本信息 | 仅一条记录 |
| `departments` | 部门介绍 | — |
| `competitions` | 竞赛活动 | `tracks` 列存储 JSON 数组 |
| `honors` | 荣誉记录 | — |
| `trainings` | 培训记录 | — |
| `registrations` | 报名信息 | 含 `createdAt` / `updatedAt` |

---

## 7. 路由说明

### 7.1 公开接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/association` | 获取协会信息 |
| GET | `/api/departments` | 获取所有部门 |
| GET | `/api/competitions` | 获取竞赛列表（按年份倒序） |
| GET | `/api/trainings` | 获取培训记录（按年份倒序） |
| GET | `/api/honors` | 获取荣誉列表（按年份倒序） |
| POST | `/api/registration` | 提交报名信息 |

### 7.2 管理员接口（需 JWT）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/admin/login` | 管理员登录 |
| POST | `/api/admin/logout` | 注销 |
| GET | `/api/admin/verify` | 验证 Token 是否有效 |
| GET | `/api/admin/profile` | 获取管理员信息 |
| GET | `/api/registration` | 获取报名列表（分页/搜索/筛选/排序） |
| GET | `/api/registration/stats` | 获取报名统计 |
| GET | `/api/registration/:id` | 获取单条报名 |
| DELETE | `/api/registration/:id` | 删除报名记录 |

---

## 8. 认证机制

### 8.1 JWT 流程

1. 管理员访问 `POST /api/admin/login`，提交账号密码。
2. `server/routes/admin.js` 验证 bcrypt 哈希。
3. 验证通过后签发 JWT，默认有效期 24 小时；`remember: true` 时为 7 天。
4. 后续请求在 `Authorization` 头中携带 `Bearer <token>`。
5. 受保护路由调用 `adminRouter.authenticateToken` 中间件验证 token。

### 8.2 关键代码

```js
// server/routes/admin.js
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

router.authenticateToken = authenticateToken;  // 导出供其他路由使用
```

---

## 9. 模型层约定

- 每个模型是一个普通对象，暴露查询方法。
- 无 ORM，使用原始 SQL。
- JSON 列手动 `JSON.parse()` 解析。

示例：

```js
// server/models/Competition.js
const db = require('../config/database');

const Competition = {
  findAll() {
    const rows = db.prepare('SELECT * FROM competitions ORDER BY year DESC').all();
    for (const row of rows) {
      if (row.tracks) row.tracks = JSON.parse(row.tracks);
    }
    return rows;
  }
};

module.exports = Competition;
```

---

## 10. 错误处理

所有路由统一使用 `try/catch`：

```js
router.get('/', async (req, res) => {
  try {
    const data = SomeModel.findAll();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});
```

---

## 11. 环境变量

在项目根目录创建 `.env`：

```env
PORT=5000
JWT_SECRET=your-secret-key-change-in-production
```

- `PORT`：服务端口，默认 5000
- `JWT_SECRET`：JWT 签名密钥，生产环境必须修改

---

## 12. 注意事项

1. **Bun 专属**：`bun:sqlite` 导致项目无法直接在 Node.js 运行。
2. **管理员账号硬编码**：当前管理员账号和密码哈希写在 `server/routes/admin.js` 中。
3. **JWT 密钥有回退默认值**：未设置环境变量时使用硬编码字符串，生产环境务必覆盖。
4. **`initDB.js` 会清空静态数据**：运行前会删除 `association`、`departments`、`competitions`、`honors`、`trainings` 表数据并重新插入；不会删除 `registrations`。
5. **`cors` 已安装但未启用**：如需跨域，请在 `server/app.js` 中挂载 `cors` 中间件。
6. **无测试/无 CI**：当前没有自动化测试、lint 或 CI 配置。

---

## 13. 扩展建议

- 如需新增数据表：在 `server/config/database.js` 中添加建表 SQL，在 `server/models/` 中新建模型，在 `server/routes/` 中新建路由，并在 `server/app.js` 中挂载。
- 如需新增管理员接口：参考 `server/routes/registration.js`，使用 `authenticateAdmin` 中间件保护。
- 如需日志或错误监控：可在 `server/app.js` 中添加全局错误处理中间件。

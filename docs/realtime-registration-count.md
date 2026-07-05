# 报名人数实时刷新方案对比

> 目标：当有人提交报名后，所有已打开的页面能实时显示最新的已报名人数。

---

## 1. 项目现状

- **前端**：纯 HTML/CSS/JS，无构建步骤，无框架。
- **后端**：Bun + Express + SQLite。
- **当前数据流**：页面加载时从后端获取数据，提交报名为一次性 POST 请求，成功后只刷新当前提交者页面。
- **并发量**：低（招新高峰期可能有少量并发，但总体不大）。

---

## 2. 可选方案概览

| 方案 | 原理 | 复杂度 | 实时性 | 服务器压力 | 推荐度 |
|------|------|--------|--------|------------|--------|
| 定时轮询（Short Polling） | 前端每隔几秒请求一次 `/api/registration/count` | 低 | 中（受间隔限制） | 中 | ⭐⭐⭐⭐ |
| 长轮询（Long Polling） | 前端发请求，后端挂起直到有更新再返回 | 中 | 高 | 低 | ⭐⭐⭐ |
| Server-Sent Events (SSE) | 服务端通过 HTTP 单向推送事件给客户端 | 中 | 高 | 低 | ⭐⭐⭐⭐⭐ |
| WebSocket | 全双工持久连接 | 高 | 高 | 低 | ⭐⭐ |
| 数据库触发 + 后端推送 | SQLite 触发器检测写入，后端通过 SSE/WS 推送 | 高 | 高 | 低 | ⭐⭐ |

---

## 3. 方案详细分析

### 3.1 定时轮询（Short Polling）

**原理**：前端每隔固定时间（如 5 秒或 10 秒）发送一次请求，获取当前报名人数。

**优点**：
- 实现最简单，完全兼容现有 Express 架构。
- 不需要引入新协议或库。
- 对低并发项目完全够用。

**缺点**：
- 不是真正的实时，有延迟（取决于轮询间隔）。
- 大量空请求会增加服务器压力和带宽。
- 用户体验不如推送方案。

**后端改动**：
- 新增 `/api/registration/count` 接口：
  ```js
  router.get('/count', async (req, res) => {
    try {
      const count = Registration.count();
      res.json({ count });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });
  ```

**前端改动**：
  ```js
  setInterval(async () => {
    const res = await fetch('/api/registration/count');
    const { count } = await res.json();
    document.getElementById('count').textContent = count;
  }, 5000); // 每 5 秒刷新一次
  ```

**适用场景**：
- 当前项目规模小、并发低，这是**最快实现、最稳妥**的方案。

---

### 3.2 长轮询（Long Polling）

**原理**：前端发送请求，后端不立即返回，而是挂起连接；当有新的报名数据时，再返回结果并关闭连接，前端收到后立刻重新发起请求。

**优点**：
- 接近实时，比定时轮询延迟低。
- 基于普通 HTTP，无需额外协议。
- 减少无效请求次数。

**缺点**：
- 后端需要维护挂起的连接和状态，实现复杂度高于定时轮询。
- 在大量客户端连接时，可能消耗较多连接资源。
- 超时要处理得妥当，否则连接会堆积。

**后端改动**：
- 需要一个内存中的“事件等待队列”或状态标记，提交报名后唤醒等待中的请求。

**适用场景**：
- 比定时轮询更适合实时性要求稍高的场景，但实现收益比不如 SSE。

---

### 3.3 Server-Sent Events (SSE) — 推荐方案

**原理**：客户端通过 `EventSource` 建立一条单向 HTTP 长连接，服务端可以随时主动推送数据到客户端。

**优点**：
- 真正的服务器推送，实时性高。
- 实现比 WebSocket 简单。
- 基于 HTTP，天然兼容现有 Express，无需引入新库（Express 原生支持）。
- 前端使用原生 `EventSource`，无需额外依赖。
- 只推送“有变化”的事件，服务器压力低。

**缺点**：
- 单向通信：只能服务端推送到客户端，不能客户端反向发送。
- 浏览器并发连接数有限（HTTP/1.1 通常每个域 6 个）。
- 断线后需要自动重连（`EventSource` 原生支持自动重连）。

**后端改动**：

```js
// server/routes/registration.js
const clients = new Set();

router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  clients.add(res);

  req.on('close', () => {
    clients.delete(res);
  });
});

function broadcastCount() {
  const count = Registration.count();
  const data = JSON.stringify({ count });
  clients.forEach(client => {
    client.write(`data: ${data}\n\n`);
  });
}

// 在 POST /api/registration 成功后调用 broadcastCount()
```

**前端改动**：

```js
const eventSource = new EventSource('/api/registration/stream');
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  document.getElementById('count').textContent = data.count;
};
eventSource.onerror = () => {
  console.error('SSE 连接出错，稍后自动重连');
};
```

**适用场景**：
- 本项目最佳方案：实时性足够、实现简单、无需引入新库。

---

### 3.4 WebSocket

**原理**：客户端和服务端建立全双工持久 TCP 连接，双方可以随时互相发送消息。

**优点**：
- 实时性最高。
- 支持双向通信，适合聊天、协作编辑等场景。

**缺点**：
- 需要引入 `ws` 或 `socket.io` 等库。
- 配置比 SSE 复杂，需要处理连接管理、心跳、重连等。
- 对于“只需要服务端推送报名人数”这一单一需求，属于过度设计。

**适用场景**：
- 不推荐本项目使用。除非未来需要双向实时通信（如在线聊天、多人协作白板）。

---

### 3.5 数据库触发器 + 后端推送

**原理**：在 SQLite 中设置触发器（`CREATE TRIGGER`），当 `registrations` 表有写入时，触发某种通知机制，后端再将更新推送给前端。

**优点**：
- 理论上能精确感知数据库变化。

**缺点**：
- SQLite 触发器本身不能通知外部进程，需要配合轮询或文件监听等机制。
- `bun:sqlite` 对触发器支持有限，且没有内置的变更通知机制。
- 实现复杂、调试困难，收益很低。

**适用场景**：
- 不推荐。项目的写入入口只有 `POST /api/registration`，直接在该接口成功后广播即可。

---

## 4. 综合推荐

### 首选：Server-Sent Events (SSE)

理由：
- 实现简单，后端只需新增一个 `/api/registration/stream` 接口，维护一个客户端连接集合。
- 前端使用原生 `EventSource`，无需引入库。
- 实时性足够，服务器压力低。
- 完美契合当前 Bun + Express + 原生 JS 的技术栈。

### 备选：定时轮询（Short Polling）

理由：
- 如果你希望最小改动、最快上线，定时轮询是最省事的方案。
- 5 秒或 10 秒轮询一次，对低并发项目完全可接受。

### 不推荐：
- **WebSocket**：需求单一，引入和维护成本高。
- **数据库触发器**：没有实际收益，实现复杂。
- **长轮询**：能实现 SSE 同样的效果，但 SSE 更优雅、更标准。

---

## 5. 实施建议（SSE 方案）

### 5.1 后端接口设计

新增接口：
- `GET /api/registration/stream` — SSE 连接，推送报名人数更新。

在 `POST /api/registration` 成功后，向所有已连接的 SSE 客户端广播最新人数。

### 5.2 数据结构设计

SSE 推送的数据格式：

```json
{
  "type": "registration_count",
  "count": 128
}
```

未来如果要扩展，可以推送其他事件（如报名关闭、录取结果更新等）。

### 5.3 前端显示设计

- 在首页、报名页等需要显示人数的位置预留 `#registration-count` 元素。
- 页面加载时先通过普通接口获取一次人数，确保即使 SSE 暂时断开也能显示。
- SSE 建立后，收到消息时更新该元素。

### 5.4 注意事项

- **连接数管理**：使用 `Set` 存储响应对象，页面关闭时清理。
- **自动重连**：`EventSource` 默认会自动重连，但需处理 `onerror` 避免刷屏日志。
- **部署兼容性**：如果使用 Nginx 等反向代理，需要配置 `proxy_buffering off;` 和超时时间，否则 SSE 会被缓冲或中断。
- **单进程限制**：SSE 客户端连接存储在内存中，如果以后部署多实例，需要引入 Redis Pub/Sub 或共享状态。

---

## 6. 结论

| 方案 | 推荐度 | 说明 |
|------|--------|------|
| **SSE** | ⭐⭐⭐⭐⭐ | 最推荐，简单、实时、低耗 |
| 定时轮询 | ⭐⭐⭐⭐ | 次选，实现最简单 |
| 长轮询 | ⭐⭐⭐ | 可行但不如 SSE 优雅 |
| WebSocket | ⭐⭐ | 过度设计 |
| 数据库触发器 | ⭐⭐ | 无收益，复杂 |

**建议采用 SSE 方案**，在现有架构上改动最小，且能显著提升用户体验。

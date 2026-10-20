# 两种单人登录方式

2026-10-20，使用者批准：默认提供账本密码，Cloudflare Access 改为可选；既有 Access 实例继续使用原登录方式。这是原首版访问设计的追加决定，原验收历史与父规格不改写。

本地实现与分层验证已完成，尚未提交或部署；详细结果及首轮测试失败／复验记录见[验证记录](verification/password-and-access.md)。

## 用户流程

- 新部署：在 Deploy to Cloudflare 表单设置 `MONI_PASSWORD`，15–128 个字符；打开应用输入密码，初始化主币种和时区，之后在设置中配置 AI／微信。
- 跳过密码：应用只显示配置指引，业务接口保持拒绝。可在 Worker Secrets 添加密码，也可按指引设置仅本人的 Access。
- 已有 Access：不要求设置密码。团队域名、应用 AUD、本人 subject 的校验与之前一致。
- 设置页显示当前方式和退出入口。密码登录退出当前浏览器会话；Access 登录退出交给 Cloudflare 的 `/cdn-cgi/access/logout`。

## 选择规则

`ACCESS_ISSUER`、`ACCESS_AUDIENCE`、`OWNER_SUBJECT` 中任意一项非空，即选择 Access；只有三项全部为空才选择密码。两套配置并存时优先 Access。部分配置、无效身份或验签失败均不能触发密码回退。

密码缺失、长度不满足要求或自动加密主密钥未准备完成时，默认拒绝。没有免登录模式、默认密码、公开注册或首次访问者认领账本。

## 共享服务端边界

`src/lib/auth.ts` 的 `verifyOwner` 同时用于页面入口和业务 API；Access 分支复用原 `verifyAccess`。SSR、server functions、聊天 SSE、设置、导出、恢复和普通写入保持同一保护。公开内容仅包括静态资源、登录页和无账本数据的部署指引；登录接口只接受有大小限制的同源 JSON。

微信仍使用已绑定渠道及内部执行授权，不需要浏览器 Cookie，也不因为新增网页密码改变通道凭据。登录方式切换不改变活动数据集、账目、会话归属、入账权限或服务配置。

## 密码会话

- 密码原值只保留在 Worker Secret `MONI_PASSWORD`。网页只在登录请求中提交，不写入 URL、localStorage、日志、前端配置或业务备份。
- 使用 256 位随机会话令牌；D1 仅保存令牌 SHA-256、凭据指纹、当前 origin 和到期时间。凭据指纹以既有独立部署密钥 `CONFIG_ENCRYPTION_KEY` 做 HMAC，带用途前缀，数据库中不保存可直接离线猜解的裸密码摘要。密码比较使用 Workers Node.js 兼容层的 `timingSafeEqual`。
- Cookie 为 `__Host-moni_session`，具备 `HttpOnly; Secure; SameSite=Strict; Path=/`，没有 Domain，有效期 30 天。登录生成新令牌，重新登录撤销当前浏览器旧令牌；退出删除对应 D1 会话，清 Cookie 后重放旧值也无效。
- 会话绑定 origin，不能将一个域名上的 Cookie 复制到其他域名使用。密码或加密主密钥变化后，旧凭据不再匹配；成功使用新密码登录会清理旧凭据会话。普通升级保留密码和主密钥。
- `auth_sessions` 和 `auth_login_limits` 不属于业务数据集，不被账本导出或恢复覆盖。登录成功清理过期会话及限流记录。
- 登录每客户端每 15 分钟最多 5 次尝试，D1 原子更新抵御并发绕过；客户端依据 Cloudflare 设置的 IP 头，保存摘要而非原始 IP。HTTP 429 返回 Retry-After。未提供该头的本地调用共用一个限流桶。
- 非回环地址的登录／退出必须 HTTPS。同源检查继续使用现有 Origin、Sec-Fetch-Site 和 JSON 类型校验，不增加宽松 CORS。

默认关闭两个 Worker 的历史版本预览 URL，避免旧版本保留历史访问配置。独立 preview Worker、D1、DO 的部署方式不变；需要在独立实例验收，不能将生产 D1 当作可写预览。

## 运维与升级

密码修改／重置在 Cloudflare 的 Worker Secrets 中进行。Access 与密码的主动切换步骤见[部署指南](deployment.md#修改密码与登录方式)。现有 Access 配置和加密主密钥不由升级脚本删除或轮换。

迁移 `0018_password_auth.sql` 只新增认证表和索引，不更新、删除或重建任何业务表。增加密码登录不会执行生产数据初始化或恢复。

实现不新增登录服务、邮件服务、KV、外部依赖或多用户系统。新增 D1 会话查询及登录写入会计入原有 D1 配额。

官方依据：[Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)、[部署按钮 Secret 表单](https://developers.cloudflare.com/workers/platform/deploy-buttons/#worker-environment-variables-and-secrets)、[Workers Node.js Crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)。

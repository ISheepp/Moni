# 两种单人登录方式

2026-10-20，使用者批准：默认提供账本密码，Cloudflare Access 改为可选；既有 Access 实例继续使用原登录方式。这是原首版访问设计的追加决定，原验收历史与父规格不改写。

2026-10-21 追加：新部署改为首次打开网站时设置密码，无需部署者操作 Secret。原 Secret 密码和 Access 兼容规则保留；[本次验证记录](verification/first-run-password.md)包含本地与独立云端验收结果，以及生产账目和 Access 的保护核对。

当前实现、分层验证与发布状态见[验证记录](verification/password-and-access.md)，包含首轮失败和复验结果。

## 用户流程

- 新部署：部署表单不需要 Secret。首次打开网站，设置并确认 15–128 个字符的密码，成功后自动登录，再初始化主币种和时区。AI／微信之后在设置中配置。
- 首次设置前：业务接口保持拒绝，仅公开设置页和最少就绪状态。设置只对无认证记录、未初始化且没有业务／服务数据的全新实例开放；已使用的账本缺少认证配置时仍拒绝访问，由部署者恢复原配置。
- 部署者须先完成首次设置再分享网址。公开空白实例的首次密码由最先成功设置者确定，应用没有其他身份依据可验证设置者是否持有 Cloudflare 账号。此流程不修改 Access owner，也不向匿名用户开放已有账本的认领。
- 已有 Access：不要求设置密码。团队域名、应用 AUD、本人 subject 的校验与之前一致。
- 设置页显示当前方式和退出入口。密码登录退出当前浏览器会话；Access 登录退出交给 Cloudflare 的 `/cdn-cgi/access/logout`。

## 选择规则

`ACCESS_ISSUER`、`ACCESS_AUDIENCE`、`OWNER_SUBJECT` 中任意一项非空，即选择 Access；只有三项全部为空才选择密码。两套配置并存时优先 Access。部分配置、无效身份或验签失败均不能触发密码回退。

环境密码长度不满足要求或自动加密主密钥未准备完成时，默认拒绝，不回退到网页初始化。环境密码为空且数据库已有网页校验值时使用网页密码；两者都没有时，仅全新空白实例可以设置初始密码。没有免登录模式、默认密码或公开注册。

## 共享服务端边界

`src/lib/auth.ts` 的 `verifyOwner` 同时用于页面入口和业务 API；Access 分支复用原 `verifyAccess`。SSR、server functions、聊天 SSE、设置、导出、恢复和普通写入保持同一保护。公开内容仅包括静态资源、登录／首次密码设置页、最少初始化状态和无账本数据的部署指引；登录和首次设置接口只接受有大小限制的同源 JSON。

微信仍使用已绑定渠道及内部执行授权，不需要浏览器 Cookie，也不因为新增网页密码改变通道凭据。登录方式切换不改变活动数据集、账目、会话归属、入账权限或服务配置。

## 密码会话

- 网页密码采用随机 256 位盐、PBKDF2-HMAC-SHA256（100000 次）保存校验值；输入先使用独立部署密钥 `CONFIG_ENCRYPTION_KEY` 做带用途前缀的 HMAC，单独复制 D1 无法离线验证猜测。原值只在同源 HTTPS 设置／登录请求中提交，不写入 URL、localStorage、日志、前端配置或业务备份。
- 旧版 `MONI_PASSWORD` Secret 继续兼容，并作为忘记密码后的部署者恢复方式。Secret 优先于网页密码，Access 优先于两者。Secret 成功登录后清除旧网页校验值并保留已配置标记；此后不能移除 Secret 来恢复旧网页密码或重开首次设置。
- `auth_credentials` 单例插入与空白实例条件在同一 SQL 写入中检查；并发首次设置只能成功一次，失败请求不会得到登录会话。已有账本、服务配置、认证记录及非空历史都阻止匿名初始化。
- 登录页在客户端交互就绪前禁用输入和提交，表单同时声明 POST。慢脚本复现曾证明，原生表单默认 GET 会将合成密码放入导航参数；这也是快速重登录需要覆盖的边界。`tests/e2e/auth.spec.ts` 的 `server-rendered login` 用例延迟实际脚本加载验证此行为，不依赖固定等待时间。
- 使用 256 位随机会话令牌；D1 仅保存令牌 SHA-256、凭据指纹、当前 origin 和到期时间。凭据指纹以既有独立部署密钥 `CONFIG_ENCRYPTION_KEY` 做 HMAC，带用途前缀，数据库中不保存可直接离线猜解的裸密码摘要。密码比较使用 Workers Node.js 兼容层的 `timingSafeEqual`。
- Cookie 为 `__Host-moni_session`，具备 `HttpOnly; Secure; SameSite=Strict; Path=/`，没有 Domain，有效期 30 天。登录生成新令牌，重新登录撤销当前浏览器旧令牌；退出删除对应 D1 会话，清 Cookie 后重放旧值也无效。
- 会话绑定 origin，不能将一个域名上的 Cookie 复制到其他域名使用。密码或加密主密钥变化后，旧凭据不再匹配；成功使用新密码登录会清理旧凭据会话。普通升级保留密码和主密钥。
- `auth_credentials`、`auth_sessions` 和 `auth_login_limits` 不属于业务数据集，不被账本导出或恢复覆盖。登录成功清理过期会话及限流记录；首次设置复用登录限流。
- 登录每客户端每 15 分钟最多 5 次尝试，D1 原子更新抵御并发绕过；客户端依据 Cloudflare 设置的 IP 头，保存摘要而非原始 IP。HTTP 429 返回 Retry-After。未提供该头的本地调用共用一个限流桶。
- 非回环地址的登录／退出必须 HTTPS。同源检查继续使用现有 Origin、Sec-Fetch-Site 和 JSON 类型校验，不增加宽松 CORS。

默认关闭两个 Worker 的历史版本预览 URL，避免旧版本保留历史访问配置。独立 preview Worker、D1、DO 的部署方式不变；需要在独立实例验收，不能将生产 D1 当作可写预览。

## 运维与升级

密码修改／重置在 Cloudflare 的 Worker Secrets 中进行。Access 与密码的主动切换步骤见[部署指南](deployment.md#修改密码与登录方式)。现有 Access 配置和加密主密钥不由升级脚本删除或轮换。

迁移 `0018_password_auth.sql` 增加认证会话与限流表，`0019_web_password.sql` 增加独立密码校验表，并为已存在的认证记录留下初始化关闭标记；都不更新、删除或重建任何业务表。升级不执行生产数据初始化或恢复。

实现不新增登录服务、邮件服务、KV、外部依赖或多用户系统。新增 D1 会话查询及登录写入会计入原有 D1 配额。

官方依据：[Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)、[部署按钮 Secret 表单](https://developers.cloudflare.com/workers/platform/deploy-buttons/#worker-environment-variables-and-secrets)、[Workers Node.js Crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)。

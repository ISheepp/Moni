# Moni v0.1 部署指南

2026-10-21 更新。默认首次打开网站设置账本密码，Cloudflare Access 可选；两种方式的规则见[访问控制](authentication.md)。历史版本的按钮部署、远端迁移、本人 Access、自定义域名与重复发布已实际验证；网页首次设置为本次追加流程，不能沿用历史结果宣称已云端通过；部署后网页配置 AI 与微信的追加需求见[网页配置设计](web-configuration.md)。验证层次见[部署记录](verification/deployment-readiness.md)。微信作为单独批准的可选扩展已提供本地接入实现，配置与待验收事项见[微信接入说明](wechat-integration.md)，不改动原 v0.1 的 19 项验收基线。

## 一键入口与默认资源

[Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/ISheepp/Moni) 从公开远端仓库复制项目并连接 Workers Builds。**只有已推送的版本进入按钮流程**；按钮显示不等于新版已上线，需核对代码版本及真实部署结果。

Worker 默认名 `moni`，保留 `workers.dev`。`DB` 绑定 D1；`CONVERSATIONS` 绑定本 Worker 导出的 SQLite `Conversation`，DO 迁移 `v1` 建立该类；`WECHAT` 绑定本 Worker 导出的 SQLite `WechatBot`，迁移 `v2` 建立该类。D1 使用 `migrations/` 有序迁移，`0015` 为会话增加来源及不参与业务备份的渠道执行授权，`0016` 增加同样排除业务备份的两档记账权限，`0017` 增加不参与业务备份的加密服务配置表，`0018`、`0019` 增加独立认证会话、限流和网页密码校验表。资源 ID 留给部署者账号创建／绑定，不提交个人 account ID、域名或数据库 ID。

构建为 `pnpm run build`，部署为 `pnpm run deploy`：Workers Builds 只构建一次，部署阶段按 **binding 名 DB** 运行远端迁移，再发布生成的 Worker，然后运行 `bootstrap-deployment-secrets.mjs` 准备加密密钥。脚本仅创建缺少的 `CONFIG_ENCRYPTION_KEY`／`WECHAT_SECRET`，已有值不读取、不替换、不输出。迁移失败即停止发布，不删除库或初始化已有账本。本机需要连同构建一起发布时使用 `pnpm deploy:local`；单独运行 `pnpm deploy` 要求已有当前目标的构建产物。依据：[官方部署按钮](https://developers.cloudflare.com/workers/platform/deploy-buttons/)。

新部署无需在部署表单填写任何 Secret。官方按钮读取根目录 `.env.example`，其中没有环境变量赋值；部署完成后首次打开网站，直接设置并确认账本密码（15–128 个字符），AI 和微信之后再配。`MONI_PASSWORD` 仅保留为旧版兼容和部署者恢复方式。空白本地示例在 `config/local.vars.example`，类型生成和 dry-run 显式使用它。选择 Access 的部署按下文配置，已有 Access 实例保持原登录方式。

## 首次部署次序

1. 审查并发布代码到自己的仓库，确认公开材料没有私密文件。按钮使用该仓库，核对资源名称和命令。
2. 完成构建、资源、全部迁移、部署和自动加密密钥准备，并分别记录结果。打开默认地址：全新实例会进入双语密码设置页；缺少迁移、binding 或自动加密密钥时，仍显示部署指引并拒绝业务访问。此阶段不调用 AI／微信。
3. 在网站输入并确认密码（15–128 个字符，不能全为空白），保存后自动登录。**部署者应先完成首次设置再分享网址**，最先成功保存的密码决定此空白实例的访问权。服务端原子写入只允许成功设置一次；已有账本／服务数据／认证记录时不会开放初始化。无需进入 Cloudflare 手动添加密码 Secret。
4. 可选 Access 方式：启用 Zero Trust，在 Worker 的 **Access** 选 **All traffic**，仅允许明确的本人邮箱／身份；将下表三项设为 Worker Secrets。`OWNER_SUBJECT` 取本人的 Zero Trust 用户 ID／已核实应用 token 的 `sub`。不上传完整 JWT、不以第一个访问者认领 owner。任何一项 Access 配置存在时，应用都会选择 Access；配置不完整或验证失败不会退回密码登录。
5. 本人登录后选主币、时区并初始化；正式账目出现后主币锁定，时区修改不改历史发生日。
6. 如需 AI，在“设置 → AI 助手”填写 API Key、Base URL、模型；可测试连接后保存。测试只请求简短合成文本，不保存配置、不读写账目，也不替代工具能力验收。微信在“设置 → 微信入口”扫码即可；可先绑定，再配 AI。两项均可跳过。
7. 用合成账目跑完线上验收，再录入私人数据。公开截图／日志只使用合成内容。

密码会话使用 30 天、HttpOnly／Secure／SameSite=Strict、无 Domain 的 Cookie；退出撤销当前会话，更新密码使旧凭证失效。密码方式支持本 Worker 的自定义和默认域名，各域名需要分别登录。登录按客户端限流，每 15 分钟最多 5 次尝试。

选择 Access 时，Worker 级 All traffic 保护同 Worker 的生产、预览及其他域名。应用仍校验 RS256 签名、issuer／AUD／有效期／应用 token／非空 subject 与唯一 owner。当前聊天为 HTTP SSE，不需要 WebSocket。依据：[Workers Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)。

公开初始化只接受全新实例的首次密码设置，不接受模型 Key、微信凭据或 Access owner 变更。设置完成后该写入入口关闭，后续访客必须登录。已有实例即使误删访问配置，也不会以首次设置流程绕过认证。主币／时区在认证后的初始化页面设置；AI Key 仅在认证后的设置页提交，保存后不回传。网页密码仅保存随机加盐、部署密钥参与的慢速校验值，认证表不进入业务备份。

| Secret | 内容与边界 |
| --- | --- |
| `MONI_PASSWORD` | 可选旧版兼容／恢复密码，15–128 个字符；设置为 Worker Secret 后覆盖网页密码，Access 仍优先。新部署不需要填写 |
| `ACCESS_ISSUER` | 自己的 Access 团队 HTTPS origin，无路径／查询 |
| `ACCESS_AUDIENCE` | 保护该 Worker 的应用 AUD |
| `OWNER_SUBJECT` | 同 issuer 下唯一本人 sub；重建组织／删除重加用户后重新核实 |
| `CONFIG_ENCRYPTION_KEY` | 部署自动生成，AES-GCM 加密网页 AI 配置；不能随普通更新轮换 |
| `WECHAT_SECRET` | 部署自动生成，独立加密微信凭据；不能随普通更新轮换 |
| `AI_API_KEY` | 旧版部署／本地可选回退；网页保存或清除后不再回退 |
| `AI_BASE_URL` | 可选兼容服务 HTTPS base URL，按供应商保留 API 路径；无账号密码、查询或片段 |
| `AI_MODEL` | 可选实际模型 ID，与其他 AI 配置一起设置 |

正常首次设置不需要控制台 Secrets。忘记密码或恢复旧版实例访问时，部署者可在控制台添加／更新 `MONI_PASSWORD`，类型选择 Secret，并 Deploy；也可使用以下交互命令，不在命令行传值：

```bash
pnpm exec wrangler secret put MONI_PASSWORD
```

选择 Access 时配置：

```bash
pnpm exec wrangler secret put ACCESS_ISSUER
pnpm exec wrangler secret put ACCESS_AUDIENCE
pnpm exec wrangler secret put OWNER_SUBJECT
```

AI 配置默认通过网页管理，无需返回控制台填写。旧环境变量配置仍可作为未设置网页配置时的回退；网页清除会明确禁用 AI，不会复活旧 Key。主密钥丢失会使已保存配置不可读，账本备份不能恢复它；保留部署 Secrets，再次提交模型 Key 可重建 AI 配置。

加密准备失败时部署命令以失败退出；Worker 可能已上传，需核对目标和权限后重试，不能删除旧密钥。

先核对当前生成配置的 Worker 名称；preview 明确使用 `--config wrangler.jsonc --env preview`。Secret 不写入 `vars`，`.dev.vars` 不上传仓库／Issue／备份。业务备份白名单不含这些绑定。依据：[Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)。

## 生产与预览隔离

此处 preview 为独立命名 Worker **`moni-preview`**，D1 默认名 **`moni-preview`**，DO 没有 `script_name`，属于独立 Worker namespace。分别完成网页首次密码设置并保留各自自动生成的加密密钥，或配置独立的 Access 应用／AUD 和 owner；不能复制生产 D1 ID、会话凭证或指向生产 DO script。两个环境默认 `preview_urls: false`，防止历史版本保留旧访问配置；独立预览 Worker 的 `workers.dev` 地址仍可用。

```bash
pnpm deploy:preview
```

该命令在**构建时**选择 `CLOUDFLARE_ENV=preview`；迁移、发布使用本次构建生成的平面配置。只在 deploy 时指定环境不能改变默认构建。两种构建共用 `dist/`，不要并行，不拿另一环境上次输出直接发布。依据：[Vite 的 Cloudflare 环境](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/)。

自动版本／分支预览 URL 与独立 preview Worker 不同。不要假定自动预览 URL 有数据隔离；核实实际 D1／DO 绑定前不运行私人写入。每个 Worker 都应分别验收所选登录方式；选择 Access 时，在各自实例启用 All traffic。

## 本地配置与迁移

写真实 `.dev.vars` 前确认 `git check-ignore .dev.vars` 成功、`git ls-files .dev.vars` 为空；通过安全编辑器写入，权限为 0600。已有文件不要覆盖。示例保持空白，不写自己的服务地址／模型／身份。

本地示例位于 [`config/local.vars.example`](../config/local.vars.example)。它只作为开发配置参考与类型／dry-run 输入；不要重新在仓库根目录增加自动发现的 Secret 示例，否则部署按钮会再次展示这些配置项。

```bash
pnpm install --frozen-lockfile
pnpm db:migrate:local
pnpm dev
```

本地页面同样必须认证：在忽略的 `.dev.vars` 设置随机 64 位十六进制 `CONFIG_ENCRYPTION_KEY` 并留空 Access 三项，即可在全新本地库的首次网页中设置密码；可选 `MONI_PASSWORD` 用于覆盖或恢复，也可使用真实 Access。自动化通过合成密码或临时测试身份运行真实本地 D1／DO，模型、报价和时间可控，不读取开发私密配置。

本地迁移只写 `.wrangler/`。远端由部署流程执行 `wrangler d1 migrations apply DB --remote`；会改变所选数据库，须先核对目标并备份。失败只回滚当前迁移，之前成功的可能保留；不要删除库或清空 migrations 表重跑，排错后继续未完成迁移。依据：[D1 migrations apply](https://developers.cloudflare.com/workers/wrangler/commands/d1/#d1-migrations-apply)。

如果直接用 CLI 首次部署而不走按钮，先由部署者创建 D1 并在自己的私密部署配置中绑定实际数据库，再执行 `pnpm deploy:local`；不能假定迁移命令会替你建库。原仓库保持无个人资源 ID 的默认示例。按钮流程则由平台先准备绑定资源；当前已有账号的真实按钮流程已验证，空白新账号的开户步骤仍需独立验收。

## 绑定自己的域名

默认地址验收后，在该 Worker 的 **Settings → Domains & Routes → Add → Custom Domain** 添加自己的域名。域名需要属于该 Cloudflare 账号下的有效 zone；先检查目标主机名的已有记录，不覆盖其他服务。Cloudflare 为 Custom Domain 创建 DNS 与证书。

自定义域名在部署者的 Cloudflare 控制台维护，公共 `wrangler.jsonc` 不填写维护者域名、账号 ID 或私人配置。启用 Worker 级 **All traffic**，同时验收自定义域名、默认 `workers.dev` 与预览地址；再次部署后核实域名和保护策略仍在。依据：[Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)。

## 不触达云端的检查

```bash
pnpm cf-typegen
pnpm check
pnpm build
pnpm check:private
pnpm deploy:dry-run
pnpm exec playwright test
```

dry-run 使用空白示例生成本机部署包，不创建资源、迁移远端或发布；不等于 Access、线上功能验收。预览先 `pnpm build:preview` 再 dry-run；之后 `pnpm build` 恢复默认构建。绑定类型由空白示例生成，不手改。

## 真实服务检查

真实模型仅读取已忽略的本机 `.dev.vars`，只发合成账目。脚本默认跳过，必须显式选择。已有代理由本机 Node 环境设置，不写入项目。

```bash
MONI_REAL_AI_SMOKE=1 node scripts/real-ai-smoke.mjs
MONI_REAL_CHAT_SMOKE=1 node scripts/real-chat-smoke.mjs
MONI_REAL_DRAFT_SMOKE=1 node scripts/real-draft-smoke.mjs
MONI_REAL_QUERY_SMOKE=1 node scripts/real-query-smoke.mjs
MONI_REAL_FX_SMOKE=1 node scripts/real-fx-smoke.mjs
```

脚本通过编译后受保护 Worker 与临时 D1／DO，结束即销毁。模型 HTTP 成功还须核对完整流、工具、持久化、上下文及本人确认。汇率核对方向、两个日期、缺币对及备注修改不重取价。历史成功不替代部署后的网络验收。

## 线上验收与恢复

- 在独立测试环境实际从 README 按钮创建新项目，部署阶段不填写密码／AI／微信／Access Secret；记录 Worker、D1、DO、全部迁移与自动加密密钥，在网站设置密码并完成账本初始化；另行验证可选 Access。按钮 UI 必须由真实流程验收，不能用本地示例扫描代替。
- 未登录、错误 issuer／AUD／非本人，在默认、独立 preview 及其他启用入口均拒绝。私有响应 no-store／noindex、robots 禁止收录、sitemap 不列私人路径。
- 两环境用相同合成记录／会话 ID 写不同内容，各自读回，核对真实 D1 ID、DO namespace 不同，不能只看 Worker 名。
- AI 留空完成手动收支、备注搜索、统计、手填外币；再验证真实模型草稿和查账，确认前无正式入账。
- 下载 JSON 并核对，恢复先预览、保存现账、明确确认；失败保留完整原账，旧卡／请求拒绝。
- 记录实际版本、迁移、服务、浏览器及隐私证据后关闭 #20；父规格无单独指令不改写／关闭。

代码回滚不会自动回滚 D1 及已应用迁移。升级前私密保存业务 JSON 及必要 D1 管理备份，先在独立 preview 验证。日志仅固定状态码／错误分类，不输出 Key、JWT、私人输入、完整备注或原始供应商错误。

## 修改密码与登录方式

首次密码在网站设置。忘记密码时，由部署者在此 Worker 的 Variables and Secrets 添加／更新 `MONI_PASSWORD` 并 Deploy，作为新的恢复密码；无需改账目、服务配置或业务备份。所有旧会话在新密码配置下失效。使用恢复密码成功登录后，服务端清理旧网页校验值并保留已配置标记，防止移除 Secret 后旧密码复活或匿名重新认领；恢复后应保留该 Secret。当前不提供匿名密码重置。勿删除认证表、重建 D1 或轮换 `CONFIG_ENCRYPTION_KEY`、`WECHAT_SECRET`。

从密码改为 Access，配置仅本人的 All traffic 与 Access 三项即可。现有 Access 实例升级时保持原方式，不要求额外密码。主动切换回密码时，先准备密码，再删除三项 Access Secret；如果已开启 Cloudflare 外层 Access，也需由部署者按预期调整该规则。不要只删除其中一项，否则应用会保持拒绝。

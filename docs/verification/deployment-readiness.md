# 首次部署准备验证

2026-10-19。范围：README 官方部署按钮、构建／迁移顺序、无私密配置的首次打开与 Access 保护边界。**以下为本地验证；尚未推送代码、创建云端资源或执行真实按钮部署。Issue #20 保持未完成。**

## 已确认的问题与修复

- 根目录 `.dev.vars.example` 会被官方按钮发现为 Secret 配置项，与“先部署，AI／微信稍后配置”的流程冲突。空白示例移到 `config/local.vars.example`，类型生成与 dry-run 显式引用；根目录 `.dev.vars*` 全部忽略。没有读取、移动或改写真实 `.dev.vars`。
- Workers Builds 会分别识别 `build` 与 `deploy`，原 `deploy` 再构建一次。现在 `build` 负责构建，`deploy` 只按 `DB` binding 迁移再发布；本机完整发布使用 `deploy:local`，preview 复用同一流程。
- 初次打开只有“配置未完成”，缺少下一步。现在仅在首页 GET／HEAD 且 Access 缺配置时显示双语引导，检查数据库基本就绪与会话 binding。数据库探测要求有最后一份迁移的 `posting_policy` 和活动账本关联，不展示查询值。
- 存储准备完成时首页 HTTP 200；空库、部分迁移或缺 binding 时 HTTP 503 并显示修复说明。引导仅只读，不接受 Key、身份认领或配置写入。其他业务请求保持拒绝；身份配置齐全后的匿名／非本人路径不变。

官方依据：[Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)、[Worker 级 Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)、[Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)。官方按钮支持自动创建 D1／DO、识别根目录示例与自定义部署脚本；不据此宣称本人 Access 策略已经自动创建。

## 本轮执行结果

| 验证 | 结果 |
| --- | --- |
| 部署命令与受限页单元用例 | 4 项通过；用临时替身执行实际 deploy 脚本，证明先迁移后上传，迁移失败不上传；未触达云端 |
| 受保护 API、部署状态与升级 | 25 项通过；真实本地 D1／DO，覆盖无 AI／微信／身份配置、空库、部分迁移、完成迁移恢复、缺 binding、HEAD 不改账本 |
| 手机／PC 部署相关浏览器验收 | 8 项通过；真实编译后 Worker，覆盖默认与中文首页、深浅主题、320px、引导重试、初始化前拦截；配置身份后的无 AI 手动外币、备注筛选、统计和备份亦通过 |
| 独立空库 Wrangler 迁移 | 16 份迁移全部通过；同一临时库第二次运行返回无待执行迁移；临时目录随后清理，未触碰开发库或远端 |
| 默认生产构建与类型 | Vite 客户端／服务端产物构建成功；首次尾部类型检查发现新增测试的子进程空环境缺少生成类型字段，补齐空值后单独 `tsc --noEmit` 通过，生产源未再变化，未重复打包 |
| Wrangler dry-run | 通过；D1、Conversation、WechatBot 绑定齐全，gzip 约 822.47 KiB，只在本机打包，未上传 |
| 格式与翻译 | 本轮相关文件格式检查通过；526 个中英键一致；引导沿用现有服务端双语受限页，不新增翻译键 |
| 隐私 | `check:private` 通过；源码、素材及构建产物无本机私密配置；`.dev.vars` 仍被 Git 忽略 |

定向复验入口：

```bash
pnpm exec vitest run tests/unit/deployment-config.test.ts tests/unit/restricted.test.ts
pnpm exec vitest run --config vitest.workers.config.ts tests/worker/deployment.test.ts tests/worker/api.test.ts tests/worker/upgrade.test.ts
pnpm exec playwright test tests/e2e/release.spec.ts --workers=2
pnpm exec tsc --noEmit
pnpm deploy:dry-run
pnpm check:private
```

浏览器和 dry-run 读取当前构建产物，源代码变更后需要先构建。本轮没有重跑全部会话／财务套件或全部浏览器用例，没有重新构建 preview，没有调用真实模型或微信；这些均不记为本轮通过。

## 授权后的发布检查

使用者随后明确授权发布并完成真实部署验收。发布前补跑一次完整 `pnpm check`：格式、526 个中英键、44 项单元、395 项本地真实 D1／DO 用例及类型检查通过；1 项可选 SDK activities 用例跳过。原有双端全量浏览器留给 GitHub CI 执行，部署相关 8 项浏览器已在本机通过。CI 复用已有构建运行浏览器验收，避免 `build` 后再次执行会重建的 `e2e` 包装命令。

## 尚待真实流程验收

1. 发布当前 Moni 版本至 GitHub；目前远端默认分支仍是初始模板，按钮不会读取本机修改。
2. 从 README 按钮进入实际 Cloudflare 流程，确认不会要求 AI／微信／Access Secret，并验证资源创建、远端 16 份迁移、首页与构建日志中只有一次构建。示例命名的本地检查不能替代按钮 UI 验收。
3. 完成仅本人的 Worker 级 All traffic、Access 身份 Secrets，验证登录与各入口拦截，再初始化并写入合成账目。
4. 在部署者控制台绑定其指定的自定义域名，验证 DNS、证书、登录跳转、默认地址及预览保护；再次部署后核对域名、Secret 和账目均保留。

真实资源创建、代码提交／推送和生产部署继续遵守用户先前保留的授权门槛。账号、个人域名、实际资源 ID、模型配置与密钥不写入公共默认配置或此记录。

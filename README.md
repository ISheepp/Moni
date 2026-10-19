# Moni

开源、自己部署的私人账本。支持中英文、手机和 PC、深浅及系统主题；Cloudflare Access 只放行本人，D1 保存账目，每会话 Durable Object 协调 AI 回复。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ISheepp/Moni)

**当前为 v0.1 部署候选版。** 按钮使用此仓库默认分支的已发布代码；首次真实部署与本人 Access 已验证；部署后网页 AI 配置与微信扫码的实现及验证见[网页配置记录](docs/verification/web-configuration.md)，完整发布边界见[部署验证记录](docs/verification/deployment-readiness.md)与[验收总表](docs/verification/v0.1-acceptance.md)。

## 功能

- 自然语言整理多笔可编辑草稿，建议类目和标签，保留逐笔备注；默认由本人确认入账，也可在设置中明确开启“直接入账”。
- 多币种与固定主币折算：ECB 参考报价、手填汇率或实际扣款，保留原币与折算依据。
- 手动收支、关联退款、回收站、类目维护和标签合并。
- 组合筛选、备注关键词、基础统计、同条件明细、会话内自然语言查账与连续追问。
- 筛选记录 CSV、完整 JSON 备份；校验预览、保存现账、明确确认后原子恢复。

AI 未配置时，手动记账、筛选、统计、手填折算和备份恢复均可使用。另提供可选的微信 ClawBot 入口：同一本账本、独立微信会话、文字记账与连续查账，默认可在微信自然回复确认意图后入账，也可在网页核对确认；支持本人设置的两档记账权限。接入配置和真实验收边界见[微信接入说明](docs/wechat-integration.md)；原 v0.1 验收基线保持不变。

## 部署

1. 点击上方 **Deploy to Cloudflare**，登录 Cloudflare 并授权 GitHub，确认仓库和应用名称。**无需填写 AI Key 或微信配置。**
2. 接受自动识别的构建命令 `pnpm run build`、部署命令 `pnpm run deploy`，等待 Worker、D1、会话 DO 和数据库迁移完成。
3. 打开 Cloudflare 给出的地址，即可看到首次使用引导与存储准备状态。
4. 按引导配置只允许本人的 Cloudflare Access，验证身份后选择主币种与时区，开始手动记账。AI 可稍后在网页设置中填写，微信在同一设置页扫码连接。

详细步骤见[部署指南](docs/deployment.md)。Access 本人策略及身份绑定须由部署者完成；完成前只能读取通用引导，业务接口继续拒绝访问，不存在首位访问者认领账本。

可在 Cloudflare 控制台给自己的实例绑定自定义域名；公共默认配置保留 `workers.dev`，不会预填项目维护者的域名或账号。

部署脚本自动生成加密主密钥并保存为 **Cloudflare Secrets**，重复部署保留已有密钥。本人登录后可在网页填写 AI Key、Base URL、模型，并按服务商说明选择 Chat Completions 或 Responses 接口；凭据用独立主密钥加密保存在服务端，不回显 Key、不进入业务备份。微信直接在设置页扫码，无需手填底层加密密钥。Key、访问令牌、个人模型配置、本人身份和私人账目不得提交到 Git。[本地配置示例](config/local.vars.example)只有空值，并特意避开部署按钮的密钥自动识别文件名；真实本机配置 `.dev.vars` 必须被 Git 忽略。

## 本地开发与验证

使用 Node.js 22.16+、pnpm 10.30.3+。

```bash
pnpm install --frozen-lockfile
pnpm db:migrate:local
pnpm dev
```

本地浏览器同样要求有效的本人 Access 身份，不提供开发后门。自动化使用独立签名身份和真实本地 D1／DO，不读取 `.dev.vars`：

```bash
pnpm check
pnpm e2e
pnpm check:private
pnpm deploy:dry-run
```

`pnpm e2e` 先构建，再运行双端用例；dry-run 必须在构建后运行，只打包不发布。真实服务为单独的显式选择，见 [指南](docs/deployment.md#真实服务检查)。

| 命令 | 用途 |
| --- | --- |
| `pnpm check` | 格式、翻译键、单元、受保护接口／真实本地 D1／DO、类型 |
| `pnpm build` | 默认 Worker 与静态资源生产构建、类型 |
| `pnpm build:preview` | 使用独立 preview 绑定构建；替换当前构建输出 |
| `pnpm locale:compile` | 从中英 JSON 重新生成 Paraglide |
| `pnpm cf-typegen` | 仅从空白示例重新生成绑定类型 |
| `pnpm deploy` | 部署已构建产物：远端 D1 迁移、发布 Worker；供 Workers Builds 使用，实际改变云端 |
| `pnpm deploy:local` | 本机先构建，再迁移和发布默认 Worker，实际改变云端 |
| `pnpm deploy:preview` | 构建、迁移、发布独立 preview Worker，实际改变云端 |

## 项目资料

- [规格](docs/specs/moni-v0.1.md)、[父 Issue #1](https://github.com/ISheepp/Moni/issues/1)、子任务 #2–#20。
- [技术方案](docs/technical-design.md)、[阶段计划](docs/implementation-plan.md)、[财务 ADR](docs/adr/)、[领域词汇](GLOSSARY.md)。
- [批准的双端设计](docs/design/moni-v0.1/REVIEW.md)、[透明素材](public/moni/)、[实现设计核对](design-qa.md)。
- [部署指南](docs/deployment.md)、[逐项验收证据](docs/verification/v0.1-acceptance.md)。

React 19、TypeScript、TanStack Start／Router／AI、Tailwind、Paraglide、Cloudflare Workers／D1／DO；图标使用 Tabler。生成文件 `src/locale/paraglide/`、`src/routeTree.gen.ts`、`worker-configuration.d.ts` 不手工编辑。

## 致谢与许可

项目从 [TanStarter Lite](https://github.com/MkFastHQ/mkfast-lite) 起步，保留其 MIT 许可及作者版权声明。Moni 依 [MIT License](LICENSE) 开源；素材来源见 [素材说明](docs/design/moni-v0.1/assets/README.md)。

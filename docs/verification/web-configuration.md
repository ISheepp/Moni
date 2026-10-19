# 网页 AI 配置与部署后微信连接验证

2026-10-19。使用者确认部署完成后在网页填写 AI、扫码微信。实现范围和安全决定见[网页配置设计](../web-configuration.md)，首次真实部署证据见[部署记录](deployment-readiness.md)。本记录区分受控测试、真实模型隔离联调及云端验收，不代表全部 v0.1 验收完成。

## 本轮结果

| 验证层次 | 结果 |
| --- | --- |
| 格式、类型与翻译 | 通过；546 个中英文键一致，Worker 类型由空白示例生成 |
| 全量单元 | 48 通过，包含部署次序和加密密钥准备的幂等／失败／日志脱敏 |
| 全量本地 D1／DO | 406 通过，1 项既有可选 SDK activities 跳过；配置与普通／微信真实 DO 共用读取路径 |
| 手机／PC 浏览器 | 74 个场景均已通过：首次全量 70 通过，4 项旧页面断言与定位修正后定向通过；复用同一生产构建，没有再次打包 |
| 构建与打包 | 默认生产构建、类型及 Wrangler dry-run 通过，gzip 约 827.89 KiB；沿用既有包体积／Zod 注释警告 |
| 真实模型隔离联调 | 通过；从已忽略且权限 0600 的本机配置读取模型，仅发送合成文本，3 次请求 HTTP 200。经受保护接口测试连接、网页配置写入、密文读取后的普通会话、备份排除和清除均通过，正式账目 0；临时 D1／DO 随运行销毁 |
| 隐私 | 私密配置扫描通过；客户端产物不含加密主密钥绑定名或服务配置表，真实凭据不在源码、截图或公共文档中 |
| 云端新增网页配置与微信扫码 | 发布后独立检查；上述模型联调运行在本地真实 Worker／D1／DO，不能视作云端真实模型或本人微信已绑定 |

配置集成覆盖：匿名／非本人／跨源拒绝、读取不回传 Key、D1 密文、业务备份排除、留空保留同域名 Key、切换服务域名必须重新填写 Key、旧窗口版本冲突、测试不保存也不写账、供应商失败不回传原始错误、密钥缺少及不可解密时安全停用、清除后不恢复旧环境 Key。微信追加用例实际经过 WechatBot／Conversation DO，先无 AI 绑定并提示，再通过网页配置生成草稿和自然确认；微信传输和模型在此用例使用可控替身。

全量执行期间，多轮和大历史集成用例曾触及默认 5 秒／后续 15 秒的测试时限；单独复验行为断言通过。最终仅为真实 D1／DO 集成配置 30 秒测试执行预算，保留原财务断言、模型 15 秒＋30 秒重试及会话执行时限，没有扩大产品超时。

双端设置卡片截图均为合成服务地址和模型，Key 已保存并清空：[PC](screenshots/ai-settings-pc.png)、[手机](screenshots/ai-settings-mobile.png)。

## 定向复验

```bash
pnpm exec vitest run tests/unit/deployment-config.test.ts tests/unit/deployment-secrets.test.ts
pnpm exec vitest run --config vitest.workers.config.ts tests/worker/ai-settings.test.ts
pnpm exec vitest run --config vitest.workers.config.ts tests/worker/wechat.test.ts -t 'can bind before AI setup'
pnpm exec playwright test tests/e2e/ai-settings.spec.ts tests/e2e/home.spec.ts --workers=2
pnpm check:private
```

浏览器复验须读取当前生产构建。真实模型联调的私密运行器和原始结果没有提交；真实微信扫码、手机端实际收发和云端持续运行尚未据本轮本地测试标为通过。部署自动准备密钥不会导入本机微信绑定或将本机 AI Key 上传到云端。

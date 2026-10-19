# pi-ai 供应商、模型配置与凭据解析调研

调研日期：2026-10-19。用途：为 AgentChat 后续接入及页面配置讨论提供版本明确的事实依据；本文件不决定产品范围、不实现功能。仅阅读包源码、类型、官方文档和仓库代码；未读取用户真实 `auth.json`、`models.json`、`.env`、云凭据或系统凭据库，未调用模型服务或登录流程。

## 结论

1. 当前 Runner **锁定且实际安装 `pi-ai 1.3.0`、`pi-durable 1.2.0`**。`pi-ai` 的 `Model` 是模型元数据、端点和兼容性描述；`apiKey`、`temperature`、请求超时、请求 transport 等属于认证或 request options，不能统称为 Model 配置。[V；A/types.d.ts:47–151、623–659]
2. `createModels()` 创建空 provider 集合。接入内置供应商需要 `setProvider(factory())`，或显式使用 `providers/all` 的 `builtinModels()`；单独导入 Model 或某个 API 不会为这个集合装配供应商。[A/models.js:34–50、517–519；A/providers/all.js:87–143]
3. `Models.stream/streamSimple` 会保留 options，再装配 auth、headers、env 并转发给 provider；**窄口在 durable 1.2.0 的公开会话配置**，其 `ConversationStreamOptions` 没有 `temperature`、请求 `maxTokens`、`samplingParams` 或 API 专属参数。模型上的 `samplingParams` 是另一条已有通路，但仅部分 OpenAI 兼容 API 消费它。[A/models.js:422–464；D/harness/types.d.ts:378–395、423–436]
4. `pi-ai` 默认从进程环境取值，默认凭据只放内存；应用可通过公开 `CredentialStore` 与 `AuthContext` 注入文件或系统凭据存储。`pi-ai` 不自动读取 coding-agent 的 `auth.json/models.json`，也不默认解释 `!command` 或 `$NAME` 字符串。[A/models.js:42–45；A/auth/context.js:19–40；A/auth/helpers.js:7–26]
5. 本机 coding-agent **1.3.0** 的当前主入口是 `ModelRuntime`；`AuthStorage` 是 `CredentialStore` 实现，`ModelRegistry` 是 runtime 的兼容 facade。其文件配置可用明文、`$NAME`/`${NAME}` 插值和 `!command`；这层规则不是 Runner 现有功能。[C/core/model-runtime.js:79–114；C/core/model-registry.js:1–14；C/core/resolve-config-value.js:116–128]

## 版本、来源与引用约定

| 对象              | 清单要求         | bun.lock         | 实际安装与读取位置                                                         |
| ----------------- | ---------------- | ---------------- | -------------------------------------------------------------------------- |
| Runner pi-ai      | `^1.2.0`         | `1.3.0`          | `runner/node_modules/@earendil-works/pi-ai/package.json:3` 为 `1.3.0`      |
| Runner pi-durable | `^1.2.0`         | `1.2.0`          | `runner/node_modules/@earendil-works/pi-durable/package.json:3` 为 `1.2.0` |
| pi-coding-agent   | 不是 Runner 依赖 | 无 Runner 锁定项 | 本机全局安装包 `package.json:3` 为 `1.3.0`，仅作对照层                     |

[V]：[Runner 清单](../../runner/package.json):11–13、[bun.lock](../../bun.lock):209、213。Bun 将依赖链接到根 `node_modules/.bun/`，根目录不存在 `node_modules/@earendil-works` 并不表示 Runner 没有依赖。另比对全局与 Runner 的 pi-ai：package.json 和 396 个 JS/d.ts 文件内容一致；本文 pi-ai 引用统一指向 Runner 安装包。

下文 `路径:起止行` 均对应**发布包实际 JS/d.ts**，不是猜测的最新 main 分支。简写目录：

- **A** = [`runner/node_modules/@earendil-works/pi-ai/dist/`](../../runner/node_modules/@earendil-works/pi-ai/dist/)。主要入口：[types.d.ts](../../runner/node_modules/@earendil-works/pi-ai/dist/types.d.ts)、[models.d.ts](../../runner/node_modules/@earendil-works/pi-ai/dist/models.d.ts)、[models.js](../../runner/node_modules/@earendil-works/pi-ai/dist/models.js)、[auth/resolve.js](../../runner/node_modules/@earendil-works/pi-ai/dist/auth/resolve.js)。
- **D** = [`runner/node_modules/@earendil-works/pi-durable/dist/`](../../runner/node_modules/@earendil-works/pi-durable/dist/)。主要入口：[harness/types.d.ts](../../runner/node_modules/@earendil-works/pi-durable/dist/harness/types.d.ts)、[harness/generation.js](../../runner/node_modules/@earendil-works/pi-durable/dist/harness/generation.js)。
- **C** = `/Users/zhuxining/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/`。当前版本的公开包可复查：[model-runtime.js](https://unpkg.com/@earendil-works/pi-coding-agent@1.3.0/dist/core/model-runtime.js)、[auth-storage.js](https://unpkg.com/@earendil-works/pi-coding-agent@1.3.0/dist/core/auth-storage.js)、[provider-composer.js](https://unpkg.com/@earendil-works/pi-coding-agent@1.3.0/dist/core/provider-composer.js)、[resolve-config-value.js](https://unpkg.com/@earendil-works/pi-coding-agent@1.3.0/dist/core/resolve-config-value.js)、[model-config.js](https://unpkg.com/@earendil-works/pi-coding-agent@1.3.0/dist/core/model-config.js)。源码仓库由 package.json 声明为 [earendil-works/pi](https://github.com/earendil-works/pi)，对应 `packages/ai` 与 `packages/coding-agent`；本次以本地发布包为版本依据，未把可变 main 当作版本证明。

## pi-ai exports 与装配方式

`package.json:13–49` 导出根入口、`./models`、`./compat`、`./providers/*`、`./api/*`、`./utils/*`、`./oauth`、`./bedrock-provider`、`./bun-oauth`。**没有独立的 `./providers` 聚合入口**；内置 provider 全量入口是 `@earendil-works/pi-ai/providers/all`，按需入口如 `/providers/deepseek`、`/providers/openai`。根入口导出 Model、Models、auth 类型和 helper，但不自动导入所有内置供应商。[A/index.d.ts:1–43；[package.json](../../runner/node_modules/@earendil-works/pi-ai/package.json):13–49]

`providers/all` 提供 `builtinProviders()`、`builtinModels(options)`、`getBuiltinModel(s)`、`getAllBuiltinModels`、`getBuiltinProviders`，以及 image/classifier 版本。内置 catalog 是随包的 generated 数据；factory 将 catalog、auth 和 API 实现组合起来。`getModels/getModel` 是同步读当前目录，**不说明凭据可用**；`getAvailable` 先检查 auth 再应用 provider 的凭据筛选。`refresh()` 是显式操作，可先恢复缓存，再按策略联网；`createModels` 自身没有全网自动发现或 coding-agent 的 pi.dev 目录更新编排。[A/providers/all.d.ts:1–45；A/models.js:66–125、178–231、291–334]

`./compat` 保留旧式全局 API dispatch、model getters、env key 注入与 registry 表面，属于迁移/兼容入口；不能由它推断当前 `Models` 实例默认注册了哪些 provider。[A/compat.d.ts:1–8、39–66]

### Provider 与自定义模型接缝

`Provider` 的完整接口分为以下成员：[A/models.d.ts:70–124]

| 部分         | 成员                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| 身份、元数据 | `id`、`name`、可选 `baseUrl`、`headers`                                                              |
| 认证         | `auth.apiKey`、`auth.oauth`，至少一个；auth 可以返回 `{ auth: {} }` 表示 ambient 或无 key 服务已配置 |
| 模型目录     | 必需 `getModels()`；可选 `getAllModels()`、`refreshModels()`、`filterModels()`、`filterAllModels()`  |
| 聊天         | 必需 `stream()`、`streamSimple()`；可选 `fetchDeferred()`、`cancelDeferred()`                        |
| 其他操作     | 可选 `generateImages()`、`classify()`                                                                |

普通内置 factory 多为零参数函数，不是接收任意 `{ apiKey, baseUrl, options }` 的通用配置构造器。Radius 是例外之一，公开 options 为 `id/name/gateway`。可以构造完整 Provider，或用 `createProvider({ id, name?, baseUrl?, headers?, auth, models, api?, images?, classifiers?, fetchModels?, filterModels?, filterAllModels? })`；`api` 是 stream 实现对象或按 API ID 的映射，**不是模型的 API 字符串**。至少需要一个操作实现。[A/providers/deepseek.d.ts:1–2；A/providers/openai.d.ts:1–2；A/providers/radius.d.ts:1–10；A/models.d.ts:211–252]

`setProvider` 按 `provider.id` 覆盖；模型 `provider` 必须指向所属 provider，`model.api` 要有对应实现。`createProvider` 的 `baseUrl/headers` 是 provider 元数据；其默认 dispatch 直接传入 `model/options`，不会自动把这些值覆盖到每个模型或请求。实际端点通常在 `Model.baseUrl`，认证返回的 `auth.baseUrl` 可在请求时再覆盖；请求 headers 从 auth、Model、options 装配。仅修改 factory 返回对象的 `baseUrl` 属性不足以证明请求端点已改。[A/models.js:46–49、422–441、535–569、603–604；A/api/openai-completions.js:535–566]

## 完整 chat Model 字段

以下是 `BaseModel + Model` 的完整字段，`?` 表示可选。[A/types.d.ts:623–659]

| 字段                             | 类型与含义                                                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                             | string；供应商内模型标识                                                                                                                                        |
| `name`                           | string；展示名称                                                                                                                                                |
| `api`                            | API 字符串，决定协议适配器                                                                                                                                      |
| `provider`                       | 供应商 ID，不是显示名                                                                                                                                           |
| `baseUrl`                        | string；请求端点，某些内置模型由环境或 auth 在请求时补齐                                                                                                        |
| `input`                          | `("text" \| "image")[]`                                                                                                                                         |
| `inputLimits?`                   | `maxRequestBytes?`；`images?: { maxPerMessage?, maxPerRequest?, resize?: { maxWidth?, maxHeight?, maxBytes?, jpegQuality? } }`；`maxBytes` 指 base64 编码后大小 |
| `cost`                           | USD/百万 token：`input/output/cacheRead/cacheWrite`；可选 `tiers[]` 每项加 `inputTokensAbove`，最高命中阈值作用于整次请求                                       |
| `headers?`                       | `Record<string,string>`；静态模型 headers，可含认证信息，不能当作天然非敏感字段                                                                                 |
| `type?`                          | `"chat"`，缺省即聊天模型                                                                                                                                        |
| `reasoning`                      | boolean；能力声明，不是当前 thinking level                                                                                                                      |
| `thinkingLevelMap?`              | `off/minimal/low/medium/high/xhigh/max` 到供应商 string 或 null 的映射；null 表示不支持                                                                         |
| `promptCache?`                   | `{ short?: number, long?: number }`；正数秒数，描述缓存寿命，不等于请求启用缓存的开关                                                                           |
| `contextWindow`                  | number；上下文窗口                                                                                                                                              |
| `maxTokens`                      | number；模型输出额度，simple API 会结合上下文估算夹紧；与请求级 `options.maxTokens` 不同                                                                        |
| `samplingParams?`                | `Record<string,unknown>`；模型默认原生采样/body 参数                                                                                                            |
| `samplingParamsByThinkingLevel?` | 以上七个 Pi thinking level 到采样参数对象的部分映射                                                                                                             |
| `compat?`                        | 按 `api` 区分的兼容配置；不是任意请求 options                                                                                                                   |

输入/缓存/价格的运行时 schema 见 [A/providers/model-schema.js:2–54](../../runner/node_modules/@earendil-works/pi-ai/dist/providers/model-schema.js)。这些字段描述能力或预处理元数据，不代表 pi-ai 自动执行所有硬限制与图像重编码；例如 coding-agent 官方文档明确 `maxRequestBytes/maxPerMessage/maxPerRequest` 当前不负责重写或拒绝历史消息。消费者行为要逐层核对，不能仅以字段存在宣称已经生效。[coding-agent 1.3.0 docs/models.md:65–91]

另外还有 `ImageModel` 与 `ClassifierModel`；它们共享 BaseModel，但前者有 `type:"image"/output`，后者有 `type:"classifier"/contextWindow`，不是可直接用于持续聊天的模型。[A/types.d.ts:661–681]

### compat 与采样参数

`compat` 按 API 区分，包括 OpenAI completions 的请求字段/角色/工具/推理格式与 routing，Responses 的工具与缓存能力，Anthropic 的 thinking/temperature/工具/缓存/fallback 能力，以及 Bedrock/Mistral 的少量差异。完整字段和默认行为直接参见 [compat-schema.js](../../runner/node_modules/@earendil-works/pi-ai/dist/providers/compat-schema.js):108–315，嵌套路由、chat template 与 fallback 类型在同文件:3–101。它描述协议兼容性，不能代替任意 request options，也不应仅因端点声称兼容就全部启用。

采样参数的优先级是：模型 `samplingParams` → 有效 thinking level 的参数 → 请求 `samplingParams`，逐 key 后者覆盖前者；这组参数最后合入请求 body，可覆盖命名字段。**仅 `openai-completions/openai-responses/azure-openai-responses` 消费；Anthropic、Google 等不能靠模型 samplingParams 获得同样效果。**[A/api/simple-options.js:11–23；A/api/openai-completions.js:750–752；A/api/openai-responses.js:304–306；A/api/azure-openai-responses.js:188–190；A/types.d.ts:114–121]

## request options、stream/complete 与 durable 边界

`Models.stream` 使用 API 专属类型 `ApiStreamOptions<TApi>`；`streamSimple` 使用跨供应商 `SimpleStreamOptions` 并由适配器映射 thinking/tool 等行为。`complete/completeSimple` 只是对应 stream 的 `.result()`，返回最终 AssistantMessage，没有另外一套非流式模型配置。[A/models.js:444–464；A/types.d.ts:167–184、227–237]

| 层                         | 完整通用成员                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProviderRequestOptions`   | `signal`、`telemetryContext`、`apiKey`、`fetch`、`env`、`onPayload`、`onResponse`、`headers`、`timeoutMs`、`maxRetries`、`maxRetryDelayMs`                    |
| `StreamOptions` 新增       | `onProviderStreamEvent`、`temperature`、`samplingParams`、`maxTokens`、`transport`、`cacheRetention`、`sessionId`、`websocketConnectTimeoutMs`、`metadata`    |
| `SimpleStreamOptions` 新增 | `toolChoice:"auto"\|"none"`、`reasoning`、`deferred`（boolean 或 `{window?:"15m"\|"1h"\|"24h"}`）、`thinkingBudgets`（minimal/low/medium/high token budgets） |
| `Models` 请求额外能力      | `transformHeaders`，auth/模型/request header 装配后执行，不下传给 provider                                                                                    |

来源：[A/types.d.ts:27–151、227–237；A/models.d.ts:48–58](../../runner/node_modules/@earendil-works/pi-ai/dist/models.d.ts)。`headers` 请求类型是 `Record<string,string|null>`，null 可抑制默认 header；与 Model 的纯 string headers 不同。transport 为 `sse/websocket/websocket-cached/auto`；cache retention 为 `none/short/long`。函数、AbortSignal、SDK client 等是运行时对象，不是可以原样放入 JSON 的配置项。

API 还存在专属参数，例如 Anthropic `thinkingEnabled/thinkingBudgetTokens/effort/thinkingDisplay/interleavedThinking/toolChoice/client`；OpenAI Responses 的 `reasoningEffort/reasoningSummary/serviceTier/toolChoice`；Google 的 `thinking`；Vertex 的 `project/location`；Bedrock 的 `region/profile/bearerToken`；Azure 的 endpoint/deployment/version；Mistral 的 `promptMode/reasoningEffort`。这些属于 API options，必须由具体调用入口及适配器支持；把任意键塞进 `SimpleStreamOptions` 不保证被转换或保留。[A/api/anthropic-messages.d.ts:3–67；A/api/openai-responses.d.ts:3–8；A/api/google-vertex.d.ts:3–12；A/api/bedrock-converse-stream.d.ts:3–35；A/api/azure-openai-config.d.ts:3–8；A/api/mistral-conversations.d.ts:6–14；A/api/simple-options.js:18–42]

`Models.applyAuth` 使用 `...providerOptions` 转发 options，装配认证本身不会过滤 `temperature`。但 **durable 1.2.0** 公开 `ConversationStreamOptions` 只包含：`transport/timeoutMs/maxRetries/maxRetryDelayMs/headers/metadata/cacheRetention/deferred`。`AgentChange` 只配置 model ref、thinking level、instructions、cwd、extensions/tools/modelTools 等，没有完整 `Model` 或 temperature 配置槽。[A/models.js:422–460；D/harness/types.d.ts:378–395、423–436]

durable generation 从 registry 取得 Model，把 settings.stream 加上自有 `signal/sessionId/reasoning` 后调用 `runtime.models.streamSimple`。因此：

- Model 中已由适配器消费的字段，可以随 registry 模型走入持续对话。
- `temperature` 等 request-only 参数，在当前公开 durable 会话配置中不能直接设置；这不是 pi-ai Models wrapper 丢参。
- 本文没有以类型断言、私有 API 或自建执行循环补齐这一边界，也没有验证某种额外 wrapper 方案已实现。

来源：[D/harness/generation.js:104–128、314–315](../../runner/node_modules/@earendil-works/pi-durable/dist/harness/generation.js)。

## pi-ai 的认证与密钥解析

`createModels({ credentials?, modelsStore?, authContext? })` 的默认值分别是内存凭据、内存目录缓存和进程环境/文件存在性检查。`modelsStore` 存的是模型目录，不是 API key。持久化凭据由应用提供。[A/models.js:34–45；A/models.d.ts:205–210]

`CredentialStore` 以 provider ID 为键，每个 provider 一条 credential：API key 为 `{type:"api_key", key?, env?}`；OAuth 为 `{type:"oauth", access, refresh, expires, ...}`。接口为 `read/list/modify/delete`，`list` 只返回 provider ID 和认证类型，不应为枚举状态执行密钥命令；`modify` 串行读改写，负责 OAuth token 轮换时的并发一致性。`AuthContext` 仅有异步 `env(name)`、`fileExists(path)`，是环境读取接缝，不是隐含 dotenv/shell 解析器。[A/auth/types.d.ts:14–104]

### 请求解析顺序

1. 若提供 request `apiKey` 且 provider 有 `auth.apiKey`，它作为临时 api_key credential 交给该 resolver。
2. 否则读取已存 credential：OAuth 走匹配的 OAuth handler；api_key 走 API key resolver。类型不匹配时返回未配置；**OAuth refresh 失败不会悄悄改用 env key**。
3. 没有存储项时，调用 provider 的 apiKey resolver 查环境或 ambient credentials。
4. 具体 resolver 可按字段把 stored key/env 与进程 env 合并。标准 `envApiKeyAuth` 优先非空 stored key，再取声明的 env 变量；Cloudflare 等还会逐字段补 account/gateway ID。因此“存储项拥有 provider”和“stored key 缺失时 resolver 可以取环境值”需分开理解。[A/auth/resolve.js:14–38；A/auth/helpers.js:15–26；A/providers/cloudflare-auth.js:4–31]

OAuth 临近到期五分钟进入 refresh，在 store.modify 锁内再次检查并保存。已经开始的 refresh 为避免丢失轮换 token，不随调用者取消直接丢弃结果，而受 15 秒超时约束。OAuth `toAuth` 返回的可能是 key、headers、特定 baseUrl，不能假定永远只是 bearer token。[A/auth/resolve.js:46–118；A/auth/types.d.ts:209–247]

请求 auth 返回 `undefined` 表示未配置；返回 `{auth:{}}` 可表示不用显式 key，但具备有效 ambient/无 key 配置。**“apiKey 为空”不等于“未配置”**。自定义本地服务器可以用自己的 resolver 表示 keyless；若使用要求 key 的通用 OpenAI SDK 适配器，还需满足该适配器的 key/header 预检（coding-agent 文档给出的本地 Ollama 配置使用 dummy key），不能仅省略 apiKey 就保证可调用。[A/models.d.ts:75–82；A/models.js:429–430；A/api/openai-completions.js:520–523；coding-agent docs/models.md:47–63]

### 内置供应商与认证类型

`builtinProviders()` 在当前发布包构造 **42 个 provider**；本次仅实例化 factory、读取 ID/认证方法/静态目录，未执行 auth resolver 或网络 refresh。下表列全部 ID，认证分组以 factory 实际 `auth` 为准。[A/providers/all.js:87–134；各 `A/providers/<id>.js`]

| 认证类别                                 | provider ID                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API key + OAuth                          | `anthropic`、`openai`、`github-copilot`、`openrouter`、`kimi-coding`、`meta`、`xai`、`radius`                                                                                                                                                                                                                                                                                                                                       |
| 仅 OAuth                                 | `openai-codex`（factory 显示为 legacy）                                                                                                                                                                                                                                                                                                                                                                                             |
| `apiKey` 接口承载 key/ambient 或额外参数 | `amazon-bedrock`、`google-vertex`、`azure`、`cloudflare-workers-ai`、`cloudflare-ai-gateway`                                                                                                                                                                                                                                                                                                                                        |
| 标准 API key                             | `ant-ling`、`baseten`、`cerebras`、`deepseek`、`fireworks`、`google`、`groq`、`huggingface`、`minimax`、`minimax-cn`、`mistral`、`moonshotai`、`moonshotai-cn`、`nvidia`、`opencode`、`opencode-go`、`qwen-token-plan`、`qwen-token-plan-cn`、`qwen-token-plan-individual`、`together`、`typesafe`、`vercel-ai-gateway`、`xiaomi`、`xiaomi-token-plan-ams`、`xiaomi-token-plan-cn`、`xiaomi-token-plan-sgp`、`zai`、`zai-coding-cn` |

常规环境变量直接由 factory 的 `envApiKeyAuth(...)` 声明。非直观命名包括 `google→GEMINI_API_KEY`、`huggingface→HF_TOKEN`、`github-copilot→COPILOT_GITHUB_TOKEN`、`vercel-ai-gateway→AI_GATEWAY_API_KEY`。完整列表参见同版本 [官方 providers.md](https://unpkg.com/@earendil-works/pi-coding-agent@1.3.0/docs/providers.md)，实际 resolver 是最终依据。

| 供应商        | 特殊配置/行为与源码                                                                                                                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anthropic     | stored key 后依次考虑 `ANTHROPIC_AUTH_TOKEN`（Bearer header）、`ANTHROPIC_OAUTH_TOKEN`、`ANTHROPIC_API_KEY`；还支持 workload identity federation 的 rule/org/token file 与可选 service account/workspace。`A/providers/anthropic.js:16–71`                            |
| Bedrock       | bearer、AWS_PROFILE、access key pair、ECS、IRSA/web identity；apiKey auth 可以返回空 auth，由 SDK credential chain 完成请求。factory 的 availability 探测只覆盖源码列出的条件，不能由“SDK支持默认链”推断所有机器都会被列为可用。`A/providers/amazon-bedrock.js:57–92` |
| Google Vertex | `GOOGLE_CLOUD_API_KEY`，或 `GOOGLE_APPLICATION_CREDENTIALS`/默认 ADC 文件 + project/location；支持 stored credential.env。`A/providers/google-vertex.js:67–94`                                                                                                        |
| Azure         | `AZURE_OPENAI_API_KEY`，端点从 `AZURE_OPENAI_BASE_URL`/`AZURE_OPENAI_RESOURCE_NAME` 或模型值解析；deployment map、API version 是额外配置，不能只存 key。`A/providers/azure.js:9–45`、`A/api/azure-openai-config.js`                                                   |
| Cloudflare    | key + `CLOUDFLARE_ACCOUNT_ID`，gateway 再要求 `CLOUDFLARE_GATEWAY_ID`；gateway auth 使用 `cf-aig-authorization` 并抑制默认上游 auth headers。`A/providers/cloudflare-auth.js:1–31、58–91`                                                                             |
| OpenAI        | 当前 `openai` 同时支持 API key 与 ChatGPT OAuth；OAuth credential 会过滤不可用的 classifier（Decisions API），不能用 keyConfigured 单布尔代表所有操作可用。`A/providers/openai.js:13–36`                                                                              |
| Radius        | 动态、按账户目录，非默认 gateway 不继承公共默认目录；`id/name/gateway` 可配置。`A/providers/radius.js:8–40、60–78`                                                                                                                                                    |
| OpenRouter    | pi-ai factory 自身是静态 baseline；coding-agent 另外包装账户定制目录和远端目录刷新，不能把 CLI 的 `/models/user` 行为归给 `openrouterProvider()`。`A/providers/openrouter.js:57–88`；`C/core/model-runtime.js:87–96`                                                  |

内置 chat API ID 为 `openai-completions`、`mistral-conversations`、`openai-responses`、`azure-openai-responses`、`openai-codex-responses`、`anthropic-messages`、`bedrock-converse-stream`、`google-generative-ai`、`google-vertex`、`pi-messages`。provider 可以同时支持多个 API，provider 和 API 不能做一对一映射。[A/types.d.ts:19–20；A/providers/all.js；A/providers/azure.js:40–44]

## coding-agent 1.3.0 的文件配置语义

`ModelRuntime.create({ credentials?, authPath?, modelsPath?, modelsStore?, ... })` 创建 RuntimeCredentials overlay，默认底层是 `AuthStorage.create(authPath)`，默认模型配置为 `<agent-dir>/models.json`；再装配内置 provider 和 coding-agent 的目录策略。`modelsPath:null` 可关闭模型配置文件。`new ModelRegistry(runtime)` 是扩展兼容 facade，不是旧文档中的 `new ModelRegistry(authStorage, modelsPath)`。[C/core/model-runtime.js:79–114；C/core/model-registry.js:1–14；同版本 examples/sdk/09-api-keys-and-oauth.ts:8–30]

`AuthStorage` 负责 JSON 文件及锁，创建文件 mode 为 0600、父目录创建 mode 为 0700；它是明文 JSON 凭据存储，不是系统密钥链或加密库。`read` 解析 api_key.key，`list` 只列元数据，OAuth refresh 的编排在 pi-ai Models。默认位置是 agent directory，可由 coding-agent 环境/SDK配置改变；不代表 AgentChat 应读取用户 Pi 的默认文件。[C/core/auth-storage.js:1–13、27–44、306–321、419–428、459–465；官方 docs/configuration.md:9–20]

### models.json 结构与覆盖

当前 schema 的 provider 配置字段是 `name/baseUrl/apiKey/api/oauth/headers/compat/authHeader/models/modelOverrides`；`oauth` 在 JSON 中只允许 `"radius"`，不是可在 JSON 中声明任意 OAuth 流程的通用开关。`models` 是 chat 定义；没有用 `type/output` 完整描述 image/classifier 的配置合同。自定义多操作和任意认证流程可走 native Provider 或 extension 编程接口。[C/core/model-config.js:21–65；C/core/provider-composer.d.ts:26–75]

`models[]` 每项支持 `id/name/api/baseUrl/reasoning/thinkingLevelMap/input/inputLimits/cost/promptCache/contextWindow/maxTokens/samplingParams/samplingParamsByThinkingLevel/headers/compat`，id 必需，其余按规则补齐。`modelOverrides` 允许同样的元数据覆盖，但**没有 id/provider/api/baseUrl**；未知 ID 不创建模型。自定义 model 的 api/baseUrl 可以从 provider 或现有默认模型继承；无可继承值时报错。默认 name=id、reasoning=false、input=[text]、cost=0、contextWindow=128000、maxTokens=16384。[C/core/model-config.js:21–53；C/core/provider-composer.js:86–123]

只改 provider baseUrl/headers 保留模型目录；`models[]` 按 ID 添加或替换，不清空其余内置模型。legacy extension 的 `models` 则替换该供应商目录；`modelOverrides` 最后应用。合并不是所有属性统一递归：cost 按字段、inputLimits 的 image/resize、thinking map、sampling、部分 compat 子对象各有具体规则。[C/core/provider-composer.js:10–84、157–199、346–364]

### 密钥字符串语义与优先级

| 输入                        | coding-agent 的含义                                                        |
| --------------------------- | -------------------------------------------------------------------------- |
| `"literal-placeholder"`     | 明文值                                                                     |
| `"MY_KEY"`                  | 仍是明文，**不会**把裸字符串自动当 env 名                                  |
| `"$MY_KEY"` / `"${MY_KEY}"` | 读取环境变量，允许混合模板如 `Bearer ${MY_KEY}`                            |
| `"!command"`                | 运行 shell 命令，取 trim 后 stdout                                         |
| `"$$"` / `"$!"`             | 非命令模板中转义字面 `$` / `!`                                             |
| `"/path/to/key"`            | 普通字符串；不是自动读取这个文件。读取外部文件需要宿主适配或命令等明确机制 |

规则来源：[C/core/resolve-config-value.js:15–72、116–128、172–217](https://unpkg.com/@earendil-works/pi-coding-agent@1.3.0/dist/core/resolve-config-value.js)。这不是 shell 的全部参数展开语法；未定义/空环境值视为 unresolved。`credential.env` 可以为模板解析提供 provider 局部值，优先于 process.env，但 env 对象的值本身不自动递归当作命令执行。[C/core/resolve-config-value.js:71–94；C/core/auth-storage.js:419–428]

- `auth.json` 的 `api_key.key` 经 `resolveConfigValue`：env 在读取时解析，`!command` 结果按原命令字符串在进程内缓存，失败/空结果也缓存。命令超时 10 秒；非零状态或空 stdout 返回 undefined。[C/core/auth-storage.js:419–428；C/core/resolve-config-value.js:123–187]
- `models.json` 的 provider apiKey、provider/model headers 经 `resolveConfigValueOrThrow/resolveHeadersOrThrow`：**请求时执行，不使用命令结果缓存**；无法解析则抛错。加载模型配置本身不解析密钥或执行命令；配置的存在性检查也不会证明命令能够成功。[C/core/model-config.js:93–132；C/core/provider-composer.js:256–304、324–336；C/core/resolve-config-value.js:192–241]
- `baseUrl`、`name`、model id 等没有被该解析器统一处理；不要把 apiKey/header 支持插值推广成“整个 JSON 所有 string 都支持 shell/env”。[C/core/provider-composer.js:87–123、157–182、289–304]

默认无扩展时，coding-agent 的常规优先顺序是：**显式请求/运行时 key → 已存 auth.json credential → models.json apiKey → provider 环境或 ambient credentials**。RuntimeCredentials 的 key overlay 是进程内的，不回写 auth.json。扩展可声明自己的 auth，或以 legacy apiKey 覆盖 configured fallback，因此不能把顺序当所有扩展必须遵守的全局规则。[C/core/runtime-credentials.js:7–21；C/core/provider-composer.js:222–224、280–298；A/auth/resolve.js:14–38]

一个有效 stored OAuth 会阻止自动走 env key；失败 refresh 不降级。若存储项是 api_key、解析后 key 缺失，内置 resolver 可能按自身逻辑继续读环境，但这并不表示会回到低优先级 models.json key。[A/auth/resolve.js:24–38；C/core/provider-composer.js:282–297]

## AgentChat 已有实现与后续待定项

当前 Runner 用 `createModels()` 手动装配 DeepSeek，替换目录为 `deepseek-chat/deepseek-reasoner`，自定义 resolver 读取进程内凭据；Rust 系统凭据库优先、`DEEPSEEK_API_KEY` 兜底。Runner 配置 schema 固定 DeepSeek/provider credentialRef；没有加载 coding-agent ModelRuntime、models.json 或 auth.json。以上仅是当前范围，不是供应商平台已经实现。[runner/src/harness/models.ts](../../runner/src/harness/models.ts):1–58；[runner/src/config/schema.ts](../../runner/src/config/schema.ts):202–225；[credentials.rs](../../src-tauri/src/credentials.rs):16–23

后续待定：开放范围是 Model 还是也包含 request options；是否支持自定义端点与多账户；采用自有 schema 还是兼容某版本 coding-agent 配置；文件与环境变量及现有系统凭据库的优先级；文件密钥是否包含明文、env 引用、路径或命令；是否纳入 OAuth/ambient 云认证；目录刷新、配置 reload 与活动会话的生效时机。以上均未作产品选择。

## 验证范围

核对了清单、锁文件与实际安装版本；静态阅读相关 JS/d.ts、同版本 coding-agent 官方 docs（models/providers/custom-provider/sdk/configuration/security/settings）及凭据 SDK 示例；离线构造 42 个内置 factory 检查认证方法与静态 API 目录，没有调用 resolver/login/refresh 或请求模型。新增文件只含调研结论，不运行应用构建或 Rust 测试。真实供应商连通、OAuth 登录、云 credential chain、密钥轮换和页面交互均未验证。

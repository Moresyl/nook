# 模型连接

在设置的“模型连接”中添加连接、填写 API 根地址和密钥，再填写模型名称。模型列表按连接保存，聊天底部可切换连接与模型。API 密钥字段使用系统加密存储，不进入工作台备份。

资料库的嵌入模型可使用独立连接，不必与聊天模型相同。在资料集设置中填写嵌入模型或 Azure 部署名称，并建立索引；语义索引与查询会发送文档片段／问题到该连接。Gemini 任务格式需按模型明确选择，Anthropic 不提供原生嵌入端点。配置、索引失效规则和来源引用见 [资料库文档](KNOWLEDGE.md)。

| 类型 | API 根地址示例 | 请求接口与认证 |
| --- | --- | --- |
| OpenAI Responses | `https://api.openai.com/v1` | `/responses`，Bearer 密钥 |
| OpenAI 兼容 API | 服务提供的根地址 | `/chat/completions`，Bearer 密钥 |
| Anthropic Messages | `https://api.anthropic.com/v1` | `/messages`，`x-api-key` |
| Ollama | `http://localhost:11434/v1` | OpenAI 兼容接口；本地默认可不填密钥 |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta` | 原生 `streamGenerateContent`，`x-goog-api-key` |
| Azure OpenAI / Foundry | `https://RESOURCE.openai.azure.com/openai/v1`，或资源根地址 | v1 Responses、v1 Chat Completions、指定版本的部署 Chat Completions；`api-key` |

Gemini 使用原生内容与工具格式。“获取模型”会读取分页列表，只显示支持 GenerateContent 的模型，并去掉 `models/` 前缀。回复中的签名及签名所属部分原样保留到本次工具续接；内部思考部分不会作为可见回复显示。工具调用缺少原生 ID 时，工作台生成内部审批 ID，返回给 Gemini 的结果仍使用原生函数名称，并仅在原响应提供 ID 时回传该 ID。

Azure 默认使用 v1 Responses，可改用 v1 Chat Completions。模型框填写资源中已部署的**部署名称**；服务的模型列表可能返回基础模型名称，需要按实际部署修改。v1 请求不添加日期版本参数。选择“部署 Chat Completions（指定版本）”时，填写资源支持的 API 版本，例如 `2024-10-21`；地址填写资源根地址或以 `/openai/v1` 结尾的根地址，工作台会切换到 `/openai/deployments/{部署名称}/chat/completions` 并加入版本参数。部署列表属于 Azure 管理接口，当前不会用推理 API 密钥伪装成部署发现。

Responses 请求使用 `store: false`，并请求加密推理项目。工具续接保留返回的原始推理、消息及函数调用项目。Azure 的 Responses 与 Chat 格式不能混用同一个续接结果。

各接口已接通原生图片输入，PDF/Office 附件以本地提取的文本进入请求。请使用支持图片的实际模型，可在“模型容量与能力”中设置图片输入能力。明确设为不支持时，图片请求会在发送前拒绝并保留草稿；未设置时由实际服务决定。格式、历史图片和请求大小限制见 [附件文档](ATTACHMENTS.md)。

保存的密钥绑定 API 类型和规范化后的根地址。仅改名称时可沿用密钥；更换类型或地址后需重新输入。测试连接也不会把旧连接的密钥发送到新地址。旧格式的凭据会在启动或恢复备份前绑定原地址；恢复同 ID、不同地址的配置不能重绑旧密钥。连接设置变更和删除会停止受影响的生成，写入失败会尝试恢复原凭据。旧密钥无法解密或格式损坏时，设置仍可打开并重新填写密钥或删除连接；失败的替换会恢复原密文。

请求不跟随重定向。列表最多保存 200 个模型；Gemini 列表最多读取十页，并拒绝重复或过长的分页令牌。JSON 响应及 SSE 事件有大小限制。鉴权、限流、无效数据和连接中断使用固定错误提示，不显示服务返回的密钥或原始错误详情。停止生成会取消请求并保留已收到的文本。

每条助手回复可打开“Token 用量”，查看各次请求的连接、模型、状态和计数。一次工具续接会产生新的请求记录；同一请求中的累积更新只替换计数，不重复相加。输入、输出及服务返回的合计分别保留。缓存读取、缓存写入和推理 token 显示为明细，不再次加到总量中。Anthropic 的基础输入计数不含缓存，工作台会把缓存读写计入统一的输入口径；Gemini 的生成输出包含其单独返回的思考计数，工具提示明细单独保留。

服务没有返回的字段显示“未返回”，不会当成零。只有同时收到输入和输出时，才会在服务省略合计的情况下求和；服务提供合计时保留原值。失败或中断前已经收到的用量仍会保存，并标明部分数据；异常计数会被忽略。记录随工作台备份和应用重启保留，恢复时把未完成的请求标为中断。统计来自服务返回值，不代表独立计费审计，也不提供推测的价格。

“获取模型”同时获取服务明确提供的资料。目前原生 Gemini 列表可提供输入、输出上限和推理能力；不会从模型名称推断容量或工具支持。其他连接的模型名称不附带推测的上限。可在“模型容量与能力”中逐个设置输入上限、输出上限、上下文窗口、工具、推理及图片输入能力；手动修改容量或能力会标为手动来源。服务资料绑定当前连接地址，更换地址或 API 类型会清除界面里的原资料，保存时也拒绝不同地址的服务资料。删除模型会同时移除该模型的资料。

“本次输出预算”会进入原生请求：Responses 使用 `max_output_tokens`，Gemini 使用 `generationConfig.maxOutputTokens`，Anthropic 使用 `max_tokens`。Anthropic 未指定预算时默认最多 8,192，并受已设置的输出上限约束。Chat 接口支持显式选择 `max_tokens` 或 `max_completion_tokens`；默认 Ollama 和 Azure 指定版本部署接口使用前者，OpenAI 兼容及 Azure v1 Chat 使用后者。不同部署可能要求不同参数，请依据服务文档选择。预算超过已设置的输出上限时不能保存。明确设为不支持工具的模型会在发送项目或扩展工具请求前被拒绝，保留原草稿。

Chat 接口默认请求最终流式用量块，支持空 `choices` 的最终计数。如果兼容服务不接受 `stream_options.include_usage`，可在设置里关闭“请求流式 token 用量”再手动发送；工作台不会自动重试可能计费的请求。中断流可能收不到最终用量块。

聊天底部显示选中连接和模型的容量，以及相同连接地址最近一次请求返回的输入计数。它不把历次调用的累计消耗当成上下文占用，也不把最近一次请求当成下一次发送的 token 估算。目前未实现发送前的精确 token 计算、容量超限预警或自动压缩。

协议测试及真实 Electron 检查使用隔离的本地 HTTP 服务，验证原生请求、流式文本、项目文件工具、工具结果续接、停止后关闭连接、系统加密与应用重启。单元测试覆盖各协议的用量口径、输出预算、容量来源、多轮持久化及失败、中断、重启和备份恢复。它们没有使用真实云端账号，不能替代真实部署的联网验证。Gemini Interactions、Azure Entra ID、更完整的能力资料、真实云端联网测试以及发送前上下文预算仍待实现。

协议依据：[Gemini GenerateContent](https://ai.google.dev/api/generate-content)、[Gemini 模型列表](https://ai.google.dev/api/models)、[Gemini 签名说明](https://ai.google.dev/gemini-api/docs/thought-signatures)、[Azure v1 API 生命周期](https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle)、[Azure Responses](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses)、[Azure 部署 API 参考](https://learn.microsoft.com/en-us/azure/foundry/openai/reference?view=rest-azureopenai-2024-10-21)。

用量依据：[OpenAI Chat 流式用量](https://platform.openai.com/docs/api-reference/chat/object)、[OpenAI 推理 token](https://developers.openai.com/api/docs/guides/reasoning)、[Responses 用量字段](https://developers.openai.com/api/reference/typescript/resources/beta/subresources/responses/methods/create)、[Anthropic 流式累积用量](https://platform.claude.com/docs/en/build-with-claude/streaming)、[Anthropic 缓存输入口径](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)、[Ollama 兼容字段](https://docs.ollama.com/api/openai-compatibility)、[Azure 部署参数兼容说明](https://github.com/Azure/azure-sdk-for-net/blob/main/sdk/openai/Azure.AI.OpenAI/src/Custom/Chat/AzureChatClient.cs)。

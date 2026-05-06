# Super Agent

一个基于 AI SDK 的命令行 Agent 示例项目，用来演示模型流式输出、工具调用、多步 Agent 循环，以及针对重复工具调用的简单“保险丝”检测。

项目默认可以不接真实模型运行：如果没有配置 `DASHSCOPE_API_KEY`，会使用本地的 `createMockModel()` 模拟模型行为；配置后会切换到兼容 OpenAI 接口的 Qwen 模型。

## 功能概览

- 命令行交互：通过 `readline` 持续读取用户输入。
- 模型抽象：使用 AI SDK 的 `streamText()` 统一驱动真实模型或本地 mock 模型。
- 工具调用：内置天气查询工具和计算工具。
- 多步循环：模型调用工具后，会把工具结果写回消息历史，再进入下一步继续推理。
- 循环检测：记录最近工具调用，检测重复调用、乒乓循环和无进展重复。
- 本地演示：输入 `测试死循环` 可以观察重复工具调用检测流程。

## 环境要求

- Node.js 20+
- pnpm

安装依赖：

```bash
pnpm install
```

启动项目：

```bash
pnpm start
```

开发模式：

```bash
pnpm dev
```

退出命令行对话：

```text
exit
```

## 可选模型配置

默认情况下，项目使用本地 mock 模型。如果要连接真实 Qwen 模型，可以在 `.env` 中配置：

```bash
DASHSCOPE_API_KEY=你的 API Key
OPENAI_BASE_URL=你的兼容 OpenAI 接口地址
OPENAI_MODEL_NAME=qwen3-coder-next
```

模型选择逻辑位于 `src/index.ts`：

```ts
const model = process.env.DASHSCOPE_API_KEY
  ? qwen.chat(process.env.OPENAI_MODEL_NAME || "qwen3-coder-next")
  : createMockModel();
```

## 目录结构

```text
src/
  index.ts           # CLI 入口：初始化模型、工具、消息历史和用户输入循环
  agent-loop.ts      # Agent 主循环：调用 streamText、处理流式输出、工具调用和工具结果
  mock-model.ts      # 本地模拟模型：实现 AI SDK LanguageModelV2 风格的 doStream / doGenerate
  tools.ts           # 工具定义：天气查询和计算器
  loop-detection.ts  # 循环检测：重复调用、乒乓循环、无进展熔断
  utils.ts           # 辅助序列化函数
```

## 整体执行流程

1. `src/index.ts` 启动命令行程序，创建模型、工具集合、消息历史和预算状态。
2. 用户输入内容后，程序把输入追加到 `messages`。
3. 调用 `agentLoop(model, tools, messages, SYSTEM, budget)`。
4. `agentLoop` 每一步调用 AI SDK 的 `streamText()`。
5. AI SDK 根据传入的 `model` 调用模型的 `doStream()`。
6. 模型可能返回普通文本流，也可能返回 `tool-call`。
7. 如果出现 `tool-call`，AI SDK 会根据工具名找到 `tools` 中对应的工具并执行。
8. 工具结果以 `tool-result` 的形式继续出现在 `result.fullStream` 中。
9. 当前 step 结束后，`agentLoop` 把 AI SDK 生成的消息追加回 `messages`。
10. 如果本轮发生过工具调用，Agent 继续下一步，让模型看到工具结果后继续回答。
11. 如果本轮没有工具调用，说明模型已经输出最终文本，本次用户请求结束。

## 工具调用流程

工具注册在 `src/index.ts`：

```ts
const tools = { get_weather: weatherTool, calculate: calculatorTool };
```

工具定义在 `src/tools.ts`。每个工具包含：

- `description`：告诉模型这个工具能做什么。
- `inputSchema`：定义工具入参结构。
- `execute`：真正执行工具逻辑。

以天气工具为例，模型发出：

```ts
{
  type: "tool-call",
  toolName: "get_weather",
  input: "{\"city\":\"北京\"}"
}
```

AI SDK 会找到 `tools.get_weather`，解析参数并调用：

```ts
weatherTool.execute({ city: "北京" });
```

然后工具返回值会变成 `tool-result`，再被 `agentLoop` 捕获并记录。

## Mock 模型如何工作

`src/mock-model.ts` 中的 `createMockModel()` 返回一个符合 AI SDK 模型接口形状的对象：

```ts
{
  specificationVersion: "v2",
  provider: "mock",
  modelId: "mock-model",
  supportedUrls,
  doGenerate,
  doStream,
}
```

当前主流程使用的是 `streamText()`，因此实际会进入 `doStream()`。

`doStream()` 会先调用 `detectToolIntent(prompt)` 判断用户意图：

- 输入包含 `测试死循环`：固定调用 `get_weather({ city: "北京" })`。
- 输入包含天气关键词和城市：调用天气工具。
- 输入包含简单算式：调用计算工具。
- 没有工具意图：返回普通文本流。

当需要工具调用时，mock 模型会构造一组流式事件：

```ts
tool-input-start -> tool-input-delta -> tool-input-end -> tool-call -> finish
```

这模拟了真实模型“逐步生成工具参数，然后发起工具调用”的行为。

## 循环检测机制

循环检测位于 `src/loop-detection.ts`，由 `agentLoop` 在每次工具调用前执行：

```ts
const detection = detect(part.toolName, part.input);
```

当前有三类检测器：

- `generic_repeat`：同一个工具用相同参数被调用太多次。
- `ping_pong`：参数在 A / B 两种模式之间反复切换。
- `global_circuit_breaker`：同一个工具、同一组参数、相同结果连续出现，说明没有进展。

检测等级分两种：

- `warning`：打印警告，并向消息历史追加系统提醒，让模型换个思路。
- `critical`：设置 `shouldBreak`，结束当前 Agent 循环。

阈值配置：

```ts
const HISTORY_SIZE = 30;
const WARNING_THRESHOLD = 5;
const CRITICAL_THRESHOLD = 8;
const BREAKER_THRESHOLD = 10;
```

## 输入“测试死循环”时会发生什么

输入：

```text
测试死循环
```

执行过程：

1. mock 模型识别到 `测试死循环`。
2. 每一步都尝试调用 `get_weather({ city: "北京" })`。
3. 工具返回固定结果：`晴，15-25°C，东南风 2 级`。
4. 前 5 次调用不会停止，只会持续进入下一步。
5. 第 6 次调用前，`generic_repeat` 检测到相同参数已调用 5 次，触发 warning。
6. `agentLoop` 把系统提醒追加到 `messages`，提示模型不要重复同样操作。
7. 下一步 mock 模型看到已有工具结果后，不再继续调用工具，转为输出最终文本。

典型输出类似：

```text
--- Step 1 ---
  [调用: get_weather({"city":"北京"})]
  [返回: "晴，15-25°C，东南风 2 级"]
  → 模型还在工作，继续下一步...

...

--- Step 6 ---
  [调用: get_weather({"city":"北京"})]
   [警告] get_weather 相同参数已调用 5 次，你可能陷入了重复
  [返回: "晴，15-25°C，东南风 2 级"]
  → 模型还在工作，继续下一步...

--- Step 7 ---
根据查询结果：晴，15-25°C，东南风 2 级
```

## 可以尝试的输入

```text
你好
北京天气怎么样
上海今天冷吗
3 + 5
4乘以2
测试死循环
```

## 目前实现上的注意点

- `agentLoop` 中的 `budget` 参数目前只传入，没有实际消费 token 预算。
- `src/index.ts` 中有一些未使用的 import，例如 `generateText`、`stepCountIs`、`streamText`、`serializeStreamPart`，后续可以清理。
- `calculatorTool` 使用 `eval()` 执行表达式。当前只是本地演示，真实项目里应改成更安全的表达式解析器。
- `loop-detection.ts` 中 `hashToolCall()` 当前直接拼接稳定字符串，而不是复用 `hash()` 生成短哈希；这便于观察参数，但日志较长时可以再改回短指纹。

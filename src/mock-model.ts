import { serializeStreamPart } from "./utils";

const TEXT_RESPONSES: Record<string, string> = {
  default:
    "你好！我是 Super Agent 的模拟模型。当前使用本地模拟回复，工具调用的机制和真实 API 完全一样。\n\n在 .env 里填入 DASHSCOPE_API_KEY 即可切换到真实的 Qwen 模型。",
  greeting:
    "你好！我是 Super Agent v0.3，现在我不只能聊天，还有保险丝保护了 :)",
  name: "你刚才告诉我了呀！不过说实话，我是模拟模型，能“记住”是因为代码把对话历史传给了我。",
};

interface ToolCallIntent {
  toolName: string;
  args: Record<string, unknown>;
}

/**
 * 从用户输入的 prompt 中提取最后一条用户消息的文本内容，并将其转换为小写字符串
 * @param prompt
 * @returns
 */
function extractUserText(prompt: any[]): string {
  const userMsgs = (prompt || []).filter((m: any) => m.role === "user");
  const last = userMsgs[userMsgs.length - 1];
  if (!last) return "";
  return (last.content || [])
    .map((c: any) => c.text || "")
    .join("")
    .toLowerCase();
}

// 检查 prompt 中是否包含工具调用结果
function hasToolResults(prompt: any[]): boolean {
  return (prompt || []).some((m: any) => {
    return m.role === "tool";
  });
}

// 检测用户输入的文本中是否包含调用工具的意图
function detectToolIntent(prompt: any[]): ToolCallIntent | null {
  const text = extractUserText(prompt);

  if (text.includes("测试死循环") || text.includes("test dead loop")) {
    return { toolName: "get_weather", args: { city: "北京" } };
  }

  if (hasToolResults(prompt)) return null;

  const weatherKeywords = [
    "天气",
    "weather",
    "温度",
    "热",
    "冷",
    "气温",
    "下雨",
    "晴",
  ];
  const hasWeatherIntent = weatherKeywords.some((kw) => text.includes(kw));
  const cities = text.match(/(北京|上海|深圳|广州|杭州|成都)/g);
  if (hasWeatherIntent && cities && cities.length > 0) {
    return { toolName: "get_weather", args: { city: cities[0] } };
  }

  // 简单的计算意图检测，匹配类似“3 + 5”或“4乘以2”这样的表达式
  const calcMatch = text.match(/(\d+)\s*[+\-*/加减乘除]\s*(\d+)/);
  if (calcMatch) {
    const op = text.match(/[+*/]|加|减|乘|除|-/)?.[0] || "+";
    const opMap: Record<string, string> = {
      加: "+",
      减: "-",
      乘: "*",
      除: "/",
    };
    // 构建计算表达式
    const expression = `${calcMatch[1]} ${opMap[op] || op} ${calcMatch[2]}`;
    return { toolName: "calculate", args: { expression } };
  }
  if (text.includes("计算") || text.includes("等于")) {
    const nums = text.match(/\d+/g);
    if (nums && nums.length >= 2) {
      return {
        toolName: "calculate",
        args: { expression: `${nums[0]} + ${nums[1]}` },
      };
    }
  }

  return null;
}

/**
 * 根据用户输入的 prompt 返回一个模拟的回复。这个函数会分析用户的最后一条消息，根据其中的关键词来选择合适的回复。
 * @param prompt
 * @returns
 */
function pickTextResponse(prompt: any[]): string {
  if (hasToolResults(prompt)) {
    const toolMsgs = (prompt || []).filter((m: any) => m.role === "tool");
    const lastResult = toolMsgs[toolMsgs.length - 1];
    const content: string = (lastResult?.content || [])
      .map((c: any) => {
        if (c.output.value) return c.output.value;
        if (c.output) return String(c.output);
        return c.text || c.result || "";
      })
      .join("");
    if (content.includes("°C") || content.includes("天气"))
      return `根据查询结果：${content}`;
    if (content.includes("=")) return `计算结果：${content}`;
    return `工具返回了以下信息：${content}`;
  }

  const text = extractUserText(prompt);
  console.log("text：", text);
  if (text.includes("你好") || text.includes("hi") || text.includes("hello"))
    if (text.includes("你好") || text.includes("hello") || text.includes("hi"))
      return TEXT_RESPONSES.greeting;
  if (text.includes("叫什么") || text.includes("名字") || text.includes("记"))
    return TEXT_RESPONSES.name;
  return TEXT_RESPONSES.default;
}

/**
 * 模拟模型的使用情况数据。这个对象包含了输入和输出的 token 数量，以及缓存的读写情况。由于这是一个模拟模型，缓存相关的数据被设置为 undefined。
 */
const USAGE = {
  inputTokens: 10,
  outputTokens: 20,
  totalTokens: 30,
};

/**
 * 创建一个模拟的 ReadableStream，用于模拟模型的流式输出。这个函数接受一个字符串数组作为输入，每个字符串代表一段回复内容。它会按照指定的时间间隔（默认为 300 毫秒）逐段输出这些内容，直到所有内容都被输出完毕。
 * @param chunks
 * @param delayMs
 * @returns
 */
function createDelayedStream(chunks: any[], delayMs = 300): ReadableStream {
  return new ReadableStream({
    start(controller) {
      let i = 0;
      function next() {
        if (i < chunks.length) {
          // 将当前段内容发送到流中
          // enqueue 方法会将数据块添加到流中，等待消费者读取
          controller.enqueue(chunks[i++]);
          setTimeout(next, delayMs);
        } else {
          controller.close();
        }
      }

      next();
    },
  });
}

/**
 * 创建一个模拟的模型对象，这个对象包含了模型的基本信息和两个主要方法：doGenerate 和 doStream。doGenerate 方法用于生成完整的回复，而 doStream 方法则用于模拟流式输出。两者都会根据用户输入的 prompt 来选择合适的回复内容。
 * @returns
 */
export function createMockModel() {
  return {
    // 模型的基本信息，包括规范版本、提供者和模型 ID。规范版本被设置为 "v2"
    specificationVersion: "v2" as const,
    provider: "mock",
    modelId: "mock-model",
    // supportedUrls 是一个 getter 方法，返回模型原生支持的 URL 规则。mock 模型不支持任何远程文件 URL，所以返回空对象。
    get supportedUrls() {
      return Promise.resolve({});
    },

    async doGenerate({ prompt }: any) {
      const text = extractUserText(prompt);

      const intent = detectToolIntent(prompt);
      if (intent) {
        return {
          content: [
            {
              type: "tool-call" as const,
              toolCallId: `call-${Date.now()}`,
              toolName: intent.toolName,
              input: intent.args,
            },
          ],
          finishReason: { unified: "tool-calls" as const, raw: undefined },
          usage: USAGE,
          warnings: [],
        };
      }
    },

    async doStream({ prompt }: any) {
      const text = extractUserText(prompt);
      const intent = detectToolIntent(prompt);

      if (intent) {
        const callId = `call-${Date.now()}`;
        const argsJson = JSON.stringify(intent.args);
        const chunks: any[] = [
          { type: "tool-input-start", id: callId, toolName: intent.toolName },
          { type: "tool-input-delta", id: callId, delta: argsJson },
          { type: "tool-input-end", id: callId },
          {
            type: "tool-call",
            toolCallId: callId,
            toolName: intent.toolName,
            input: argsJson,
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: undefined },
            usage: USAGE,
          },
        ];

        return { stream: createDelayedStream(chunks, 20) };
      }

      const replyText = pickTextResponse(prompt);
      const id = "text-1";
      const chunks: any[] = [
        { type: "text-start", id },
        ...replyText
          .split("")
          .map((char: string) => ({ type: "text-delta", id, delta: char })),
        { type: "text-end", id },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: undefined },
          usage: USAGE,
        },
      ];
      return { stream: createDelayedStream(chunks, 30) };
    },
  };
}

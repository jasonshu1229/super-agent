import type { LanguageModel } from "ai";

// MockLanguageModel 是一个类型别名，它从 LanguageModel 类型中提取出规范版本为 "v2" 的模型类型。这意味着 MockLanguageModel 代表了符合 v2 规范的语言模型接口。
type MockLanguageModel = Extract<LanguageModel, { specificationVersion: "v2" }>;
// MockCallOptions 是一个类型别名，它表示调用 MockLanguageModel 的 doGenerate 方法时所需的参数类型。它通过使用 TypeScript 的 Parameters 工具类型，从 MockLanguageModel 的 doGenerate 方法中提取出参数类型。
type MockCallOptions = Parameters<MockLanguageModel["doGenerate"]>[0];

const RESPONSES: Record<string, string> = {
  default:
    "你好！我是模拟模型。填了 DASHSCOPE_API_KEY 后会自动切换到真实的 Qwen。",
  greeting: "你好！虽然是模拟的，但流式输出的效果和真实 API 一致 :)",
  name: '你刚才告诉我了呀！我能"记住"是因为代码把对话历史传给了我。',
  intro: "我是通义千问（模拟版），在本地模拟回复，机制和真实 API 完全一致。",
};

/**
 * 根据用户输入的 prompt 返回一个模拟的回复。这个函数会分析用户的最后一条消息，根据其中的关键词来选择合适的回复。
 * @param prompt
 * @returns
 */
function pickResponse(prompt: any[]): string {
  const userMsgs = (prompt || []).filter((m: any) => m.role === "user");
  const last = userMsgs[userMsgs.length - 1];
  const content = Array.isArray(last?.content) ? last.content : [];
  const text = content
    .map((c: any) => c.text || "")
    .join("")
    .toLowerCase();

  if (text.includes("介绍你自己") || text.includes("你是谁"))
    return RESPONSES.intro;
  if (text.includes("你好") || text.includes("hi") || text.includes("hello"))
    return RESPONSES.greeting;
  if (text.includes("叫什么") || text.includes("记住")) return RESPONSES.name;

  return RESPONSES.default;
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
export function createMockModel(): MockLanguageModel {
  return {
    // 模型的基本信息，包括规范版本、提供者和模型 ID。规范版本被设置为 "v2"
    specificationVersion: "v2" as const,
    provider: "mock",
    modelId: "mock-model",
    // supportedUrls 是一个 getter 方法，返回模型原生支持的 URL 规则。mock 模型不支持任何远程文件 URL，所以返回空对象。
    get supportedUrls() {
      return Promise.resolve({});
    },

    async doGenerate({ prompt }: MockCallOptions) {
      return {
        content: [{ type: "text", text: pickResponse(prompt) }],
        finishReason: "stop",
        usage: USAGE,
        warnings: [],
      };
    },

    async doStream({ prompt }: MockCallOptions) {
      const text = pickResponse(prompt);
      const id = "text-1";
      const chunks = [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id },
        ...text.split("").map((char: string) => ({
          type: "text-delta",
          id,
          delta: char,
        })),
        { type: "text-end", id },
        {
          type: "finish",
          finishReason: "stop",
          // 在流式输出的最后一条消息中包含使用情况数据，模拟模型的使用情况数据被设置为 USAGE 常量。
          usage: USAGE,
        },
      ];

      return { stream: createDelayedStream(chunks, 30) };
    },
  };
}

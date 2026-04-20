import "dotenv/config";
import { generateText, ModelMessage, stepCountIs, streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createMockModel } from "./mock.model";
import { createInterface } from "readline"; // 用于创建命令行接口
import { weatherTool, calculatorTool } from "./tools";
import { serializeStreamPart } from "./utils";

const qwen = createOpenAI({
  baseURL: process.env.OPENAI_BASE_URL,
  apiKey: process.env.DASHSCOPE_API_KEY,
});

// 1. 创建模型实例
const model = process.env.DASHSCOPE_API_KEY
  ? qwen.chat(process.env.OPENAI_MODEL_NAME || "qwen3-coder-next")
  : createMockModel();

// 创建 readline 接口，用于从命令行读取输入
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

// 2. 定义工具集合消息历史
const messages: ModelMessage[] = [];
const tools = { get_weather: weatherTool, calculate: calculatorTool };

// 3. 定义 system prompt
const systemPrompt = `你是 Super Agent，一个专注于软件开发的 AI 助手。
你说话简洁直接，喜欢用代码示例来解释问题。
如果用户的问题不够清晰，你会反问而不是瞎猜。`;

// 4. 定义一个函数来处理用户输入并与模型交互
function ask() {
  // a. 等用户输入
  rl.question("\nYou: ", async (input) => {
    const trimmed = input.trim();
    if (!trimmed || trimmed === "exit") {
      console.log("Bye!");
      rl.close();
      return;
    }

    // b. 将用户输入添加到消息列表中
    messages.push({ role: "user", content: trimmed });

    // c. 发给模型（调用 streamText 时，SDK 会处理流式输出）
    const result = streamText({
      model,
      system: systemPrompt,
      messages,
      tools,
      stopWhen: stepCountIs(5), // 最多跑 5 步就停下来，防止死循环
    });

    // d. 流式输出模型回复
    process.stdout.write("Assistant: ");
    let fullResponse = "";
    for await (const part of result.fullStream) {
      // console.log(`\n[fullStream event]\n${serializeStreamPart(part)}`);

      switch (part.type) {
        case "text-delta":
          process.stdout.write(part.text); // 实时输出增量文本
          fullResponse += part.text; // 累积完整回复
          break;
        case "tool-call":
          console.log(
            `\n  [调用工具: ${part.toolName}(${JSON.stringify(part.input)})]`,
          );
          break;
        case "tool-result":
          console.log(`  [工具返回: ${JSON.stringify(part.output)}]`);
          break;
      }
    }
    console.log();

    messages.push({ role: "assistant", content: fullResponse });

    ask();
  });
}

// 6. 启动对话循环
console.log('Super Agent v0.2 — Agent Loop (type "exit" to quit)\n');
ask();

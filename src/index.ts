import "dotenv/config";
import { generateText, ModelMessage, streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createMockModel } from "./mock.model";
import { createInterface } from "readline";

const qwen = createOpenAI({
  baseURL: process.env.OPENAI_BASE_URL,
  apiKey: process.env.DASHSCOPE_API_KEY,
});

const model = process.env.DASHSCOPE_API_KEY
  ? qwen.chat(process.env.OPENAI_MODEL_NAME || "qwen3-coder-next")
  : createMockModel();

// 创建 readline 接口，用于从命令行读取输入
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

const messages: ModelMessage[] = [];

function ask() {
  // 1. 等用户输入
  rl.question("\nYou: ", async (input) => {
    const trimmed = input.trim();
    if (!trimmed || trimmed === "exit") {
      console.log("Bye!");
      rl.close();
      return;
    }

    // 2. 将用户输入添加到消息列表中
    messages.push({ role: "user", content: trimmed });

    // 3. 发给模型
    const result = streamText({
      model,
      messages,
    });

    // 4. 流式输出模型回复
    process.stdout.write("Assistant: ");
    let fullResponse = "";
    for await (const chunk of result.textStream) {
      process.stdout.write(chunk);
      fullResponse += chunk;
    }
    console.log();

    messages.push({ role: "assistant", content: fullResponse });

    ask();
  });
}

console.log('Super Agent v0.1 (type "exit" to quit)\n');
ask();

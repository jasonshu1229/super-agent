import "dotenv/config";
import { generateText, ModelMessage, stepCountIs, streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createMockModel } from "./mock-model";
import { createInterface } from "readline"; // 用于创建命令行接口
import { weatherTool, calculatorTool } from "./tools";
import { serializeStreamPart } from "./utils";
import { agentLoop, type BudgetState } from "./agent-loop";

const qwen = createOpenAI({
  baseURL: process.env.OPENAI_BASE_URL,
  apiKey: process.env.DASHSCOPE_API_KEY,
});

// 1. 创建模型实例
const model = process.env.DASHSCOPE_API_KEY
  ? qwen.chat(process.env.OPENAI_MODEL_NAME || "qwen3-coder-next")
  : createMockModel();

// 2. 定义工具集合消息历史
const messages: ModelMessage[] = [];
const tools = { get_weather: weatherTool, calculate: calculatorTool };

// 预算由调用方持有，跨轮持续累计——agentLoop 只负责消费它
const budget: BudgetState = { used: 0, limit: 1000 }; // 示例预算状态，实际使用时可以根据需要调整
// 创建 readline 接口，用于从命令行读取输入
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

// 3. 定义 system prompt
const SYSTEM = `你是 Super Agent，一个有工具调用能力的 AI 助手。
需要查询信息时，主动使用工具，不要编造数据。
回答要简洁直接。`;

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

    messages.push({ role: "user", content: trimmed });

    await agentLoop(model, tools, messages, SYSTEM, budget);

    ask();
  });
}

// 6. 启动对话循环
console.log('Super Agent v0.3 — Fuses (type "exit" to quit)\n');
console.log("试试输入：“测试死循环”、“测试重试” 或随便聊几轮观察 Token 用量\n");
ask();

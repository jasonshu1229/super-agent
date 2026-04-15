import "dotenv/config";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createMockModel } from "./mock.model";

const qwen = createOpenAI({
  baseURL: process.env.OPENAI_BASE_URL,
  apiKey: process.env.DASHSCOPE_API_KEY,
});

const model = process.env.DASHSCOPE_API_KEY
  ? qwen.chat(process.env.OPENAI_MODEL_NAME || "qwen3-coder-next")
  : createMockModel();

async function main() {
  const { text } = await generateText({
    model,
    prompt: "用一句话介绍你自己",
  });

  console.log(text);
}

main();

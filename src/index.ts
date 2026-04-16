import "dotenv/config";
import { generateText, streamText } from "ai";
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
  // const { text } = await generateText({
  //   model,
  //   prompt: "用一句话介绍你自己",
  // });

  const result = streamText({
    model,
    prompt: "用一句话介绍你自己",
  });

  for await (const chunk of result.textStream) {
    // 实时输出生成的文本，连续输出
    process.stdout.write(chunk);
  }

  console.log();
}

main();

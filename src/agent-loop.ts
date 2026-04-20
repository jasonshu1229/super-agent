import { streamText, type ModelMessage } from "ai";

const MAX_STEPS = 10;

export async function agentLoop(
  model: any,
  tools: any,
  messages: ModelMessage[],
  system: string,
) {
  let steps = 0;

  while (steps < MAX_STEPS) {
    steps++;

    console.log(`\n--- Step ${steps} ---`);

    const result = streamText({
      model,
      system,
      messages,
      tools,
    });

    let hasToolCall = false;
    let fullText = "";

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          process.stdout.write(part.text);
          fullText += part.text;
          break;

        case "tool-call":
          hasToolCall = true;
          console.log(
            `  [调用: ${part.toolName}(${JSON.stringify(part.input)})]`,
          );
          break;

        case "tool-result":
          console.log(`  [返回: ${JSON.stringify(part.output)}]`);
          break;
      }
    }

    const stepMessages = await result.response;
    // console.log("stepMessages 是：", stepMessages);
    messages.push(...stepMessages.messages);

    if (!hasToolCall) {
      if (fullText) console.log();
      break;
    }

    // 还有工具调用 继续循环，让模型看到工具结果后继续思考
    console.log("  → 模型还在工作，继续下一步...");
  }

  if (steps >= MAX_STEPS) {
    console.log("\n[达到最大步数限制，强制停止]");
  }
}

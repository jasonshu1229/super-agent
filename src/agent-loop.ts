import { streamText, type ModelMessage } from "ai";
import {
  detect,
  resetHistory,
  recordCall,
  recordResult,
} from "./loop-detection";

const MAX_STEPS = 15;

export interface BudgetState {
  used: number;
  limit: number;
}

export async function agentLoop(
  model: any,
  tools: any,
  messages: ModelMessage[],
  system: string,
  budget: BudgetState,
) {
  let steps = 0;
  resetHistory();

  while (steps < MAX_STEPS) {
    steps++;
    console.log(`\n--- Step ${steps} ---`);

    const result = streamText({
      model,
      system,
      messages,
      tools,
      maxRetries: 0, // 由外部循环控制重试，内部不自动重试
      onError: () => {},
    });

    let hasToolCall = false;
    let fullText = "";
    //  用于标记是否需要提前结束循环，例如检测到模型没有调用工具但又没有生成文本时，可以认为模型可能卡住了，这时就可以设置 shouldBreak = true 来跳出循环，避免无意义的等待。
    let shouldBreak = false;
    // 记录当前循环中模型调用的最后一个工具和输入，以便在下一轮循环开始时进行对比，判断是否有进展。
    let lastToolCall: { name: string; input: unknown } | null = null;

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          process.stdout.write(part.text);
          fullText += part.text;
          break;

        case "tool-call":
          hasToolCall = true;
          lastToolCall = { name: part.toolName, input: part.input };
          console.log(
            `  [调用: ${part.toolName}(${JSON.stringify(part.input)})]`,
          );

          // 循环检测：在记录工具调用之前，先进行循环检测，判断当前的工具调用是否可能导致循环。如果检测到循环，根据严重程度决定是直接熔断还是给模型一个提示，让它换个思路。
          const detection = detect(part.toolName, part.input);
          if (detection.stuck) {
            console.log(`   ${detection.message}`);
            if (detection.level === "critical") {
              shouldBreak = true;
            } else {
              messages.push({
                role: "user" as const,
                content: `[系统提醒] ${detection.message}。请换一个思路解决问题，不要重复同样的操作。`,
              });
            }
          }
          recordCall(part.toolName, part.input);

          break;

        case "tool-result":
          console.log(`  [返回: ${JSON.stringify(part.output)}]`);
          if (lastToolCall) {
            recordResult(lastToolCall.name, lastToolCall.input, part.output);
          }
          break;
      }
    }

    if (shouldBreak) {
      console.log(`\n[循环检测出发，Agent 已停止]`);
      break;
    }

    const stepMessages = await result.response;
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

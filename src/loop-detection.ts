import { createHash } from "node:crypto";

// --- 类型定义 ---

// 工具调用记录的结构，包含工具名称、参数哈希、结果哈希和时间戳
export interface ToolCallRecord {
  toolName: string; // 工具名称，例如 "weather" 或 "calculate"
  argsHash: string; // 输入参数的哈希值，用于快速比较不同调用的输入是否相同
  resultHash?: string; // 输出结果的哈希值，用于快速比较不同调用的输出是否相同
  timestamp: number; // 调用的时间戳，单位为毫秒
}

// 循环检测类型
export type DetectorKind =
  | "generic_repeat" // 通用重复检测，适用于任何工具调用的重复情况
  | "ping_pong" // 乒乓循环检测，专门针对两个工具互相调用的情况设计
  | "global_circuit_breaker"; // 全局断路器

// 循环检测结果类型，包含是否检测到循环以及相关信息
export type DetectionResult =
  | { stuck: false }
  | {
      stuck: true; // 是否检测到循环
      level: "warning" | "critical"; // 循环的严重程度
      detector: DetectorKind; // 触发检测的类型
      count: number; // 循环调用的次数
      message: string; // 详细的循环检测信息
    };

// --- 配置 ---

const HISTORY_SIZE = 30; // 滑动窗口大小
const WARNING_THRESHOLD = 5; // 警告阈值（演示用，生产环境通常是 10）
const CRITICAL_THRESHOLD = 8; // 严重阈值（演示用，生产环境通常是 20）
const BREAKER_THRESHOLD = 10; // 熔断阈值（演示用，生产环境通常是 30）

// --- 指纹计算 ---
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as any)[k])}`).join(",")}}`;
}

// 生成输入的哈希值
function hash(input: string): string {
  // 使用 SHA-256 哈希算法生成输入的哈希值，并截取前 16 个字符作为指纹，确保在日志中展示时既简洁又具有足够的区分度。
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

// 生成工具调用的哈希值，结合工具名称和参数的稳定字符串化结果，确保相同工具和相同参数的调用具有相同的哈希值。
export function hashToolCall(toolName: string, params: unknown): string {
  return `${toolName}:(${stableStringify(params)})`;
}

// 生成结果的哈希值，使用与工具调用参数相同的稳定字符串化和哈希算法，确保相同结果具有相同的哈希值。
export function hashResult(result: unknown): string {
  return hash(stableStringify(result));
}

// --- 滑动窗口 ---

// 保留最近 HISTORY_SIZE 条工具调用记录
const history: ToolCallRecord[] = [];

// 记录工具调用的函数，在每次工具调用时被调用，负责将调用信息添加到历史记录中，并确保历史记录的大小不超过预设的窗口大小。
export function recordCall(toolName: string, params: unknown): void {
  history.push({
    toolName,
    argsHash: hashToolCall(toolName, params),
    timestamp: Date.now(),
  });
  // 超出窗口大小时，移除最旧的一条
  if (history.length > HISTORY_SIZE) history.shift();
}

// 记录工具调用结果的函数
//  在工具执行后补写结果指纹。
//  这里从后往前找，是为了命中“最近一次相同调用但尚未写结果”的记录。
export function recordResult(
  toolName: string,
  params: unknown,
  result: unknown,
): void {
  const argsHash = hashToolCall(toolName, params);
  const resultHash = hashResult(result);
  // 找到最近一次调用的记录并更新其结果哈希值
  for (let i = history.length - 1; i >= 0; i--) {
    if (
      history[i].toolName === toolName &&
      history[i].argsHash === argsHash &&
      !history[i].resultHash
    ) {
      history[i].resultHash = resultHash;
      break;
    }
  }
}

// 重置历史记录，通常在测试开始前调用
export function resetHistory(): void {
  history.length = 0;
}

// --- 检测器 ---

// 统计“同一个工具 + 同一组参数 + 相同结果”的连续次数，作为无进展的指标
function getNoProgressStreak(toolName: string, argsHash: string): number {
  // 统计最近连续调用同一工具且输入相同但输出没有变化的次数
  let steak = 0;
  // lastResultHash 用于记录最近一次调用的结果哈希值，以便与当前调用的结果进行比较，判断是否有进展。
  let lastResultHash: string | undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    const r = history[i];
    if (r.toolName !== toolName || r.argsHash !== argsHash) continue;
    if (!r.resultHash) continue; // 如果还没有结果哈希值，说明这个调用还没有完成，不纳入统计，继续往前找。

    // 第一次调用
    if (!lastResultHash) {
      // 最近一次调用，记录结果哈希值
      lastResultHash = r.resultHash;
      steak = 1;
      continue;
    }
    // 一旦结果发生变化，就说明有进展，连续计数结束。
    if (r.resultHash !== lastResultHash) break;
    // 如果结果哈希值发生变化，说明有进展，停止统计。
    steak++;
  }
  return steak;
}

// 检测参数是否在 A/B 两种模式之间来回切换，例如 A -> B -> A -> B
function getPingPongCount(currentHash: string): number {
  if (history.length < 3) return 0;

  const last = history[history.length - 1];
  // 先找到与最近一次调用不同的那组参数，作为 “B”。
  let otherHash: string | undefined;
  // 从后往前找到第一个与最近一次调用（last）参数不同的调用，记录其参数哈希值作为 otherHash
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i].argsHash !== last.argsHash) {
      otherHash = history[i].argsHash;
      break;
    }
  }
  // 如果没有找到不同参数的调用，说明没有形成 A-B 交替，直接返回 0
  if (!otherHash) return 0;
  // 继续往前找，统计参数在 last.argsHash（A）和 otherHash（B）之间来回切换的次数
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const expected = count % 2 === 0 ? last.argsHash : otherHash;
    if (history[i].argsHash !== expected) break;
    count++;
  }
  // 最后检查当前准备执行的调用是否正好是交替模式中的另一侧，如果是且交替次数达到 2 次以上，则说明形成了 A-B-A 或 B-A-B 的乒乓模式，返回交替的总次数（包括当前调用）。
  if (currentHash === otherHash && count >= 2) return count + 1;
  return 0;
}

// --- 主检测函数 ---
export function detect(toolName: string, params: unknown): DetectionResult {
  // 计算当前调用的参数哈希值，用于后续的循环检测逻辑中进行比较和统计。
  const argsHash = hashToolCall(toolName, params);
  // 同一调用持续无进展，直接熔断
  const noProgress = getNoProgressStreak(toolName, argsHash);

  // 无进展调用
  if (noProgress >= BREAKER_THRESHOLD) {
    return {
      stuck: true,
      level: "critical",
      detector: "global_circuit_breaker",
      count: noProgress,
      message: `[熔断] ${toolName} 已重复 ${noProgress} 次且无进展，强制停止`,
    };
  }

  // 乒乓检测
  const pingPong = getPingPongCount(argsHash);
  if (pingPong >= CRITICAL_THRESHOLD) {
    return {
      stuck: true,
      level: "critical",
      detector: "ping_pong",
      count: pingPong,
      message: `[熔断] 检测到乒乓循环（${pingPong} 次交替），强制停止`,
    };
  }
  if (pingPong >= WARNING_THRESHOLD) {
    return {
      stuck: true,
      level: "warning",
      detector: "ping_pong",
      count: pingPong,
      message: `[警告] 检测到乒乓循环（${pingPong} 次交替），请注意可能的循环风险，建议换个思路`,
    };
  }

  // 通用重复检测
  const recentCount = history.filter(
    (r) => r.toolName === toolName && r.argsHash === argsHash,
  ).length;
  if (recentCount >= CRITICAL_THRESHOLD) {
    return {
      stuck: true,
      level: "critical",
      detector: "generic_repeat",
      count: recentCount,
      message: `[熔断] ${toolName} 相同参数已调用 ${recentCount} 次，强制停止`,
    };
  }
  if (recentCount >= WARNING_THRESHOLD) {
    return {
      stuck: true,
      level: "warning",
      detector: "generic_repeat",
      count: recentCount,
      message: `[警告] ${toolName} 相同参数已调用 ${recentCount} 次，你可能陷入了重复`,
    };
  }

  // 没命中任何规则，说明当前还看不出明显卡住。
  return {
    stuck: false,
  };
}

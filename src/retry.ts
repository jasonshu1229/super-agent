/**
 * 判断错误是否可重试
 * @param error 错误对象
 * @returns
 */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message || "";

  console.log("message：", message);

  // HTTP 状态码
  const statusMatch = message.match(/(\d{3})/);
  if (statusMatch) {
    const status = parseInt(statusMatch[1]);
    if ([429, 529, 408].includes(status)) return true;
    if (status >= 500 && status < 600) return true;
    if (status >= 400 && status < 500) return false;
  }

  // 网络错误
  if (message.includes("ECONNRESET") || message.includes("EPIPE")) return true;
  if (message.includes("ETIMEDOUT") || message.includes("timeout")) return true;
  if (message.includes("fetch failed") || message.includes("network"))
    return true;
  // AI SDK 会把流式错误包装成 NoOutputGeneratedError
  if (message.includes("No output generated")) return true;

  return false;
}

// --- 指数会比 + 随机抖动 ---

/**
 * 计算重试延迟时间，基于指数退避和随机抖动
 * @param attempt 当前尝试次数，从 1 开始
 * @param baseMs 基础延迟时间（毫秒），默认 500ms
 * @param maxMs 最大延迟时间（毫秒），默认 30000ms（30秒）
 * @returns 返回计算后的延迟时间（毫秒）
 */
export function calculateDelay(
  attempt: number, // 当前重试尝试次数，类型为 number
  baseMs = 500, // 基础延迟时间（毫秒），默认值 500ms
  maxMs = 30000, // 最大延迟时间（毫秒），默认值 30000ms
): number {
  // 计算指数退避延迟: baseMs * 2^(attempt-1)
  const exponential = baseMs * Math.pow(2, attempt - 1);

  // 将延迟限制在最大值 maxMs 之内
  const capped = Math.min(exponential, maxMs);

  // 计算抖动范围，这里取 capped 的 25%
  const jitterRange = capped * 0.25;

  // 在 [-jitterRange, +jitterRange] 范围内随机抖动
  // Math.random() * 2 - 1 生成 [-1, 1] 的随机数
  const jittered = capped + (Math.random() * 2 - 1) * jitterRange;

  // 确保延迟不小于 0，并四舍五入为整数毫秒
  return Math.max(0, Math.round(jittered));
}

/**
 * 睡眠指定的毫秒数，返回一个 Promise，在指定时间后 resolve
 * @param ms 要睡眠的时间，单位为毫秒
 * @returns 一个 Promise，在指定时间后 resolve
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

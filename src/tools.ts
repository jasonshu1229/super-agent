import { jsonSchema } from "ai";

export const weatherTool = {
  description: "查询指定城市的天气信息",
  inputSchema: jsonSchema({
    type: "object",
    properties: {
      city: {
        type: "string",
        description: "要查询天气的城市名称，例如：北京、上海、广州等",
      },
    },
    required: ["city"],
    additionalProperties: false, // 不允许输入除 city 以外的其他字段
  }),
  execute: async ({ city }: { city: string }) => {
    const mockWeather: Record<string, string> = {
      北京: "晴，15-25°C，东南风 2 级",
      上海: "多云，18-22°C，西南风 3 级",
      深圳: "阵雨，22-28°C，南风 2 级",
    };
    return mockWeather[city] || `抱歉，${city}：暂无数据`;
  },
};

export const calculatorTool = {
  description: "计算数学表达式的结果。当用户提问涉及数学运算时使用",
  inputSchema: jsonSchema({
    type: "object",
    properties: {
      expression: {
        type: "string",
        description:
          "要计算的数学表达式，例如：2 + 3 * (4 - 1)，表达式中只能包含数字、加减乘除和括号",
      },
    },
    required: ["expression"],
    additionalProperties: false, // 不允许输入除 expression 以外的其他字段
  }),
  execute: async ({ expression }: { expression: string }) => {
    try {
      const result = eval(expression);
      return typeof result === "number" ? result.toString() : "表达式无效";
    } catch (error) {
      return `无法计算：${expression}`;
    }
  },
};

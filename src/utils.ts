export function serializeStreamPart(part: unknown): string {
  return JSON.stringify(
    part,
    (_key, value) => {
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
        };
      }

      return value;
    },
    2,
  );
}

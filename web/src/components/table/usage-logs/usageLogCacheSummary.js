export const getCacheReadPercentage = (cacheReadTokens, promptTokens) => {
  const readTokens = Number(cacheReadTokens);
  const inputTokens = Number(promptTokens);
  if (
    !Number.isFinite(readTokens) ||
    readTokens <= 0 ||
    !Number.isFinite(inputTokens) ||
    inputTokens <= 0
  ) {
    return null;
  }

  return Math.min(100, (readTokens / inputTokens) * 100);
};

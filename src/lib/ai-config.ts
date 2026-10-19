export function aiConfiguration(env: Env) {
  if (!env.AI_API_KEY || !env.AI_BASE_URL || !env.AI_MODEL) return null;
  try {
    const url = new URL(env.AI_BASE_URL);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      env.AI_MODEL.length > 200
    )
      return null;
    return {
      apiKey: env.AI_API_KEY,
      baseURL: url.toString(),
      model: env.AI_MODEL,
    };
  } catch {
    return null;
  }
}

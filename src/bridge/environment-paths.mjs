export function expandEnvironmentTokens(value, env = process.env) {
  const entries = Object.entries(env);
  return String(value || "").replace(/%([^%]+)%/g, (token, name) => {
    const direct = env[name];
    if (direct != null) return direct;
    const match = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return match?.[1] ?? token;
  });
}

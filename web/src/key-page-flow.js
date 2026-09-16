export async function createKeyWithPrompt({ request, name, onKeyCreated }) {
  const key = await request("/api/api-keys", {
    method: "POST",
    body: JSON.stringify({ name })
  });
  onKeyCreated(key);

  try {
    const prompt = await request(`/api/api-keys/${key.id}/installation-token`, { method: "POST" });
    return { key, prompt, promptError: "" };
  } catch (error) {
    return { key, prompt: null, promptError: error.message };
  }
}

export function isPromptExpired(expiresAt, now = Date.now()) {
  return !expiresAt || new Date(expiresAt).getTime() <= now;
}

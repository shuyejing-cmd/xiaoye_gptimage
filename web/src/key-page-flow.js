export async function createKeyWithPrompt({ request, name, onKeyCreated, issuePrompt = true }) {
  const key = await request("/api/api-keys", {
    method: "POST",
    body: JSON.stringify({ name })
  });
  onKeyCreated(key);

  if (!issuePrompt) return { key, prompt: null, promptError: "", promptSkipped: true };

  try {
    const prompt = await request(`/api/api-keys/${key.id}/installation-token`, { method: "POST" });
    return { key, prompt, promptError: "", promptSkipped: false };
  } catch (error) {
    return { key, prompt: null, promptError: error.message, promptSkipped: false };
  }
}

export function isPromptExpired(expiresAt, now = Date.now()) {
  return !expiresAt || new Date(expiresAt).getTime() <= now;
}

import pg from "pg";

export function createPool({ connectionString, max = 10 }) {
  return new pg.Pool({ connectionString, max, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
}

export async function withTransaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

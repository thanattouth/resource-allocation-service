const DEFAULT_DB_QUERY_TIMEOUT_MS = 3000;

function getDbQueryTimeoutMs() {
  const parsed = Number.parseInt(
    process.env.DB_QUERY_TIMEOUT_MS || `${DEFAULT_DB_QUERY_TIMEOUT_MS}`,
    10
  );

  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DB_QUERY_TIMEOUT_MS;
}

async function setLocalStatementTimeout(client, timeoutMs = getDbQueryTimeoutMs()) {
  await client.query("SELECT set_config('statement_timeout', $1, true)", [
    `${timeoutMs}`
  ]);
}

function isDatabaseTimeoutError(error) {
  return error?.code === '57014';
}

async function runInStatementTimeoutSession(pool, handler, timeoutMs = getDbQueryTimeoutMs()) {
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await setLocalStatementTimeout(client, timeoutMs);
    const result = await handler(client);
    await client.query('COMMIT');
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('[db] Rollback error:', rollbackError.message);
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getDbQueryTimeoutMs,
  isDatabaseTimeoutError,
  runInStatementTimeoutSession,
  setLocalStatementTimeout
};

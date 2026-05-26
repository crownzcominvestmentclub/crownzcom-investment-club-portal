const sdk = require('node-appwrite');

module.exports = async ({ req, res, log, error }) => {
  const client = new sdk.Client();
  const users = new sdk.Users(client);
  const databases = new sdk.Databases(client);

  client
    .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const ADMIN_LABEL = process.env.ADMIN_LABEL || 'admin';
  const ADMIN_USER_IDS = new Set(
    String(process.env.ADMIN_USER_IDS || process.env.APPWRITE_ADMIN_USER_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );

  const DATABASE_ID = process.env.DATABASE_ID;
  const SAVINGS_COLLECTION_ID = process.env.SAVINGS_COLLECTION_ID;
  const LEDGER_COLLECTION_ID = process.env.LEDGER_ENTRIES_COLLECTION_ID;

  const getRequesterUserId = (request) => {
    const headers = request?.headers || {};
    return (
      headers['x-appwrite-user-id'] ||
      headers['X-Appwrite-User-Id'] ||
      headers['x-appwrite-userid'] ||
      headers['X-Appwrite-Userid'] ||
      null
    );
  };

  const isAdminUser = async (requesterId) => {
    if (!requesterId) return false;
    if (ADMIN_USER_IDS.has(requesterId)) return true;
    const user = await users.get(requesterId);
    return Array.isArray(user.labels) && user.labels.includes(ADMIN_LABEL);
  };

  const createLedgerEntry = async (entry) => {
    if (!LEDGER_COLLECTION_ID) return null;
    const payload = {
      type: 'Savings',
      amount: entry.amount,
      memberId: entry.memberId || null,
      loanId: null,
      month: entry.month || null,
      year: entry.year || null,
      createdAt: entry.createdAt || new Date().toISOString(),
      notes: entry.notes || ''
    };

    return databases.createDocument(
      DATABASE_ID,
      LEDGER_COLLECTION_ID,
      sdk.ID.unique(),
      payload
    );
  };

  try {
    const payload = JSON.parse(req.body || '{}');
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    const rawDate = payload.date || payload.createdAt || payload.paymentDate;
    const rawMonth = payload.month;

    if (!DATABASE_ID || !SAVINGS_COLLECTION_ID) {
      throw new Error('Missing DATABASE_ID or SAVINGS_COLLECTION_ID env vars.');
    }

    const requesterId = getRequesterUserId(req);
    const isAdmin = await isAdminUser(requesterId);
    if (!isAdmin) {
      return res.json({ success: false, error: 'Admin privileges required.' }, 403);
    }

    if (!rawDate && !rawMonth) {
      throw new Error('date (YYYY-MM-DD) or month (YYYY-MM) is required.');
    }

    if (entries.length === 0) {
      throw new Error('entries array is required.');
    }

    const dateValue = rawDate ? new Date(rawDate) : null;
    if (rawDate && Number.isNaN(dateValue.getTime())) {
      throw new Error('Invalid date format.');
    }

    const resolvedMonth = rawMonth || (dateValue ? dateValue.toISOString().slice(0, 7) : null);
    const createdAt = dateValue ? dateValue.toISOString() : new Date().toISOString();
    const yearValue = resolvedMonth ? parseInt(resolvedMonth.split('-')[0], 10) : null;

    const results = {
      created: [],
      skipped: [],
      failed: []
    };

    for (const entry of entries) {
      const memberId = entry?.memberId;
      const amount = parseInt(entry?.amount, 10);

      if (!memberId || !Number.isFinite(amount) || amount <= 0) {
        results.skipped.push({
          memberId,
          amount: entry?.amount ?? null,
          reason: 'Invalid memberId or amount'
        });
        continue;
      }

      try {
        const savingData = {
          memberId,
          amount,
          month: resolvedMonth,
          createdAt
        };

        const createdDoc = await databases.createDocument(
          DATABASE_ID,
          SAVINGS_COLLECTION_ID,
          sdk.ID.unique(),
          savingData
        );

        await createLedgerEntry({
          amount,
          memberId,
          month: resolvedMonth,
          year: Number.isFinite(yearValue) ? yearValue : null,
          createdAt
        });

        results.created.push({
          savingId: createdDoc.$id,
          memberId,
          amount
        });
      } catch (entryError) {
        results.failed.push({
          memberId,
          amount,
          error: entryError?.message || 'Failed to create saving entry'
        });
      }
    }

    return res.json({
      success: results.failed.length === 0,
      date: rawDate || null,
      month: resolvedMonth,
      summary: {
        created: results.created.length,
        skipped: results.skipped.length,
        failed: results.failed.length
      },
      results
    });
  } catch (err) {
    error(`Batch savings error: ${err.message}`);
    return res.json({ success: false, error: err.message }, 400);
  }
};

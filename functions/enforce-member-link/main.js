const sdk = require('node-appwrite');

module.exports = async ({ req, res, log, error }) => {
  const client = new sdk.Client();
  const users = new sdk.Users(client);
  const databases = new sdk.Databases(client);

  client
    .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const DATABASE_ID = process.env.DATABASE_ID;
  const MEMBERS_COLLECTION_ID = process.env.MEMBERS_COLLECTION_ID;
  const ADMIN_LABEL = process.env.ADMIN_LABEL || 'admin';
  const ALLOWED_EMAILS = new Set(
    String(process.env.ALLOWED_EMAILS || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );

  const parsePayload = () => {
    if (!req?.body) return {};
    try {
      return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      return {};
    }
  };

  const payload = parsePayload();
  const user = payload.user || payload.data || payload;
  const userId = user.$id || user.id || payload.userId || payload.id || null;
  const email = (user.email || payload.email || '').toLowerCase();
  const labels = Array.isArray(user.labels) ? user.labels : Array.isArray(payload.labels) ? payload.labels : [];

  if (!DATABASE_ID || !MEMBERS_COLLECTION_ID) {
    error('Missing DATABASE_ID or MEMBERS_COLLECTION_ID env vars.');
    return res.json({ success: false, error: 'Missing configuration.' }, 500);
  }

  if (!userId) {
    error('No user id found in event payload.');
    return res.json({ success: false, error: 'Missing user id.' }, 400);
  }

  if (labels.includes(ADMIN_LABEL)) {
    log(`Allowed admin user ${userId}`);
    return res.json({ success: true, allowed: true, reason: 'admin' });
  }

  if (email && ALLOWED_EMAILS.has(email)) {
    log(`Allowed user by allowlist ${userId}`);
    return res.json({ success: true, allowed: true, reason: 'allowlist' });
  }

  const listAllDocuments = async (collectionId, queries = []) => {
    const all = [];
    let cursor = null;
    const limit = 100;

    while (true) {
      const pageQueries = [
        ...queries,
        sdk.Query.limit(limit),
        ...(cursor ? [sdk.Query.cursorAfter(cursor)] : [])
      ];
      const response = await databases.listDocuments(DATABASE_ID, collectionId, pageQueries);
      all.push(...response.documents);
      if (response.documents.length < limit) break;
      cursor = response.documents[response.documents.length - 1].$id;
    }

    return all;
  };

  let memberFound = false;
  if (email) {
    try {
      const response = await databases.listDocuments(
        DATABASE_ID,
        MEMBERS_COLLECTION_ID,
        [sdk.Query.equal('email', email), sdk.Query.limit(1)]
      );
      memberFound = response.documents.length > 0;
    } catch (err) {
      error(`Member lookup failed: ${err.message}`);
    }
  }

  if (!memberFound && email) {
    try {
      const allMembers = await listAllDocuments(MEMBERS_COLLECTION_ID);
      memberFound = allMembers.some(
        (member) => String(member.email || '').toLowerCase() === email
      );
    } catch (err) {
      error(`Fallback member scan failed: ${err.message}`);
    }
  }

  if (!memberFound) {
    try {
      await users.delete(userId);
      log(`Deleted unlinked user ${userId} (${email || 'no email'})`);
      return res.json({ success: true, deleted: true, reason: 'not_member' });
    } catch (err) {
      error(`Failed to delete user ${userId}: ${err.message}`);
      return res.json({ success: false, error: 'Failed to delete user.' }, 500);
    }
  }

  log(`Allowed linked user ${userId}`);
  return res.json({ success: true, allowed: true, reason: 'member_linked' });
};

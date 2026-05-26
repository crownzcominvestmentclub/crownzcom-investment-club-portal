const sdk = require('node-appwrite');

module.exports = async ({ req, res, log, error }) => {
  const client = new sdk.Client();
  const users = new sdk.Users(client);
  const databases = new sdk.Databases(client);

  client
    .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  let userId = null;
  let authUserCreated = false;
  const ADMIN_LABEL = process.env.ADMIN_LABEL || 'admin';
  const ADMIN_USER_IDS = new Set(
    String(process.env.ADMIN_USER_IDS || process.env.APPWRITE_ADMIN_USER_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );

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

  try {
    const {
      action,
      name,
      email,
      password,
      phone,
      membershipNumber,
      joinDate,
      memberId,
      authUserId
    } = JSON.parse(req.body);

    // Log environment variables (without sensitive data)
    log('DATABASE_ID: ' + process.env.DATABASE_ID);
    log('MEMBERS_COLLECTION_ID: ' + process.env.MEMBERS_COLLECTION_ID);

    if (action === 'delete') {
      if (authUserId) {
        await users.delete(authUserId);
        log('Auth user deleted: ' + authUserId);
      } else {
        log('No authUserId provided; skipping auth deletion.');
      }

      if (memberId) {
        await databases.deleteDocument(
          process.env.DATABASE_ID,
          process.env.MEMBERS_COLLECTION_ID,
          memberId
        );
        log('Member document deleted: ' + memberId);
      } else {
        log('No memberId provided; skipping member deletion.');
      }

      return res.json({
        success: true,
        message: 'Member deletion processed'
      });
    }

    if (action === 'adminUpdateMemberAuth') {
      const requesterId = getRequesterUserId(req);
      const isAdmin = await isAdminUser(requesterId);
      if (!isAdmin) {
        return res.json({ success: false, error: 'Admin privileges required.' }, 403);
      }

      if (!memberId) {
        throw new Error('memberId is required for admin updates.');
      }

      const memberDoc = await databases.getDocument(
        process.env.DATABASE_ID,
        process.env.MEMBERS_COLLECTION_ID,
        memberId
      );

      const resolvedAuthUserId = authUserId || memberDoc.authUserId;
      if (!resolvedAuthUserId) {
        throw new Error('authUserId could not be resolved for this member.');
      }

      const updates = {};
      if (name !== undefined) updates.name = String(name).trim();
      if (phone !== undefined) updates.phone = String(phone).trim();
      if (email !== undefined) updates.email = String(email).trim().toLowerCase();
      if (membershipNumber !== undefined) updates.membershipNumber = String(membershipNumber).trim();
      if (joinDate !== undefined) updates.joinDate = joinDate;

      const authUpdated = {
        emailUpdated: false,
        passwordUpdated: false
      };

      if (email) {
        await users.updateEmail(resolvedAuthUserId, String(email).trim().toLowerCase());
        authUpdated.emailUpdated = true;
      }

      if (password) {
        await users.updatePassword(resolvedAuthUserId, String(password));
        authUpdated.passwordUpdated = true;
      }

      let memberUpdated = false;
      if (Object.keys(updates).length > 0) {
        await databases.updateDocument(
          process.env.DATABASE_ID,
          process.env.MEMBERS_COLLECTION_ID,
          memberId,
          updates
        );
        memberUpdated = true;
      }

      return res.json({
        success: true,
        memberId,
        authUserId: resolvedAuthUserId,
        authUpdated,
        memberUpdated,
        message: 'Admin member auth/profile update completed.'
      });
    }

    if (!name || !email || !phone || !membershipNumber) {
      throw new Error('Missing required fields: name, email, phone, membershipNumber.');
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedName = String(name).trim();
    const normalizedPhone = String(phone).trim();
    const normalizedMembershipNumber = String(membershipNumber).trim();

    if (!normalizedEmail) {
      throw new Error('Email is required.');
    }

    let user = null;
    try {
      log('Creating user in Auth...');
      user = await users.create(
        sdk.ID.unique(),
        normalizedEmail,
        normalizedPhone,
        password,
        normalizedName
      );
      userId = user.$id;
      authUserCreated = true;
      log('User created with ID: ' + userId);
    } catch (createUserError) {
      const message = String(createUserError?.message || '').toLowerCase();
      if (!message.includes('already') && !message.includes('exists')) {
        throw createUserError;
      }

      // If auth user exists already (e.g. pre-created / prior OAuth), reuse it by email.
      const existingUsers = await users.list([sdk.Query.limit(100)], normalizedEmail);
      user = existingUsers.users.find((entry) =>
        String(entry.email || '').trim().toLowerCase() === normalizedEmail
      );
      if (!user) {
        throw new Error(`Auth user already exists for ${normalizedEmail} but could not be resolved.`);
      }
      userId = user.$id;
      log('Reusing existing auth user ID: ' + userId);
    }

    const memberData = {
      name: normalizedName,
      email: normalizedEmail,
      phone: normalizedPhone,
      membershipNumber: normalizedMembershipNumber,
      authUserId: userId,
      joinDate: joinDate || new Date().toISOString().split('T')[0],
      status: 'active'
    };

    // Upsert behavior by email to avoid duplicate member profiles.
    const existingMemberByEmail = await databases.listDocuments(
      process.env.DATABASE_ID,
      process.env.MEMBERS_COLLECTION_ID,
      [sdk.Query.equal('email', normalizedEmail), sdk.Query.limit(1)]
    );

    let memberDoc;
    if (existingMemberByEmail.documents.length > 0) {
      const existingMember = existingMemberByEmail.documents[0];
      memberDoc = await databases.updateDocument(
        process.env.DATABASE_ID,
        process.env.MEMBERS_COLLECTION_ID,
        existingMember.$id,
        memberData
      );
      log('Updated existing member document ID: ' + memberDoc.$id);
    } else {
      log('Attempting to create document with data: ' + JSON.stringify(memberData));
      const documentId = sdk.ID.unique();
      log('Generated document ID: ' + documentId);
      memberDoc = await databases.createDocument(
        process.env.DATABASE_ID,
        process.env.MEMBERS_COLLECTION_ID,
        documentId,
        memberData
      );
    }
    
    log('Document created successfully!');
    log('Document ID from response: ' + memberDoc.$id);
    log('Full document: ' + JSON.stringify(memberDoc));

    // Verify the document was actually created by reading it back
    try {
      const verifyDoc = await databases.getDocument(
        process.env.DATABASE_ID,
        process.env.MEMBERS_COLLECTION_ID,
        memberDoc.$id
      );
      log('Document verified! ID: ' + verifyDoc.$id);
    } catch (verifyError) {
      error('Document verification failed: ' + verifyError.message);
    }

    return res.json({
      success: true,
      userId,
      memberId: memberDoc.$id,
      member: memberDoc,
      message: 'Member created successfully'
    });

  } catch (err) {
    error('Error creating member: ' + err.message);
    error('Error stack: ' + err.stack);
    
    if (authUserCreated && userId) {
      try {
        await users.delete(userId);
        log('Cleaned up orphaned user: ' + userId);
      } catch (deleteErr) {
        error('Failed to delete orphaned user: ' + deleteErr.message);
      }
    }

    return res.json({
      success: false,
      error: err.message
    }, 400);
  }
};

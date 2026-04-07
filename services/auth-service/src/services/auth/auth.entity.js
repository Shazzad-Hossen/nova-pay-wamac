const {
  hashRefreshToken,
  issueAccessToken,
  issueRefreshToken,
  buildRefreshExpiry,
  verifyAccessToken,
  getJwks,
  comparePassword,
  hashPassword
} = require('./auth.service');

module.exports.register = ({ pool }) => async (req, res) => {
  try {
    const { email, password, role = 'user' } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'email and password are required' });
    }

    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({ success: false, message: 'role must be admin or user' });
    }

    const passwordHash = await hashPassword(password);

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, $3)
       RETURNING id, email, role, created_at`,
      [email.toLowerCase().trim(), passwordHash, role]
    );

    return res.status(201).json({ success: true, user: result.rows[0] });
  } catch (error) {
    if (String(error.message).toLowerCase().includes('duplicate')) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }
    console.error('❌ Register error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports.login = ({ pool, settings }) => async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'email and password are required' });
    }

    const userRes = await pool.query(
      `SELECT id, email, password_hash, role
       FROM users
       WHERE email = $1`,
      [email.toLowerCase().trim()]
    );

    if (userRes.rowCount === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const user = userRes.rows[0];
    const ok = await comparePassword(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const accessToken = issueAccessToken({ userId: user.id, role: user.role, settings });
    const rawRefresh = issueRefreshToken();
    const refreshToken = hashRefreshToken(rawRefresh);
    const expiresAt = buildRefreshExpiry({ settings });

    await pool.query(
      `INSERT INTO refresh_tokens (token, user_id, expires_at)
       VALUES ($1, $2, $3)`,
      [refreshToken, user.id, expiresAt]
    );

    return res.json({
      success: true,
      access_token: accessToken,
      refresh_token: rawRefresh,
      token_type: 'Bearer',
      expires_in: '15m',
      user: { id: user.id, email: user.email, role: user.role }
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports.refresh = ({ pool, settings }) => async (req, res) => {
  let client;
  try {
    const { refresh_token: rawRefresh } = req.body;

    if (!rawRefresh) {
      return res.status(400).json({ success: false, message: 'refresh_token is required' });
    }

    const oldHash = hashRefreshToken(rawRefresh);

    client = await pool.connect();
    await client.query('BEGIN');

    const tokenRes = await client.query(
      `SELECT token, user_id, expires_at
       FROM refresh_tokens
       WHERE token = $1
       FOR UPDATE`,
      [oldHash]
    );

    if (tokenRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(401).json({ success: false, message: 'Invalid refresh token' });
    }

    const tokenRow = tokenRes.rows[0];
    if (new Date(tokenRow.expires_at) < new Date()) {
      await client.query('DELETE FROM refresh_tokens WHERE token = $1', [oldHash]);
      await client.query('COMMIT');
      return res.status(401).json({ success: false, message: 'Refresh token expired' });
    }

    const userRes = await client.query(
      `SELECT id, email, role FROM users WHERE id = $1`,
      [tokenRow.user_id]
    );

    if (userRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    const user = userRes.rows[0];

    // rotation: delete old and issue new refresh token atomically
    await client.query('DELETE FROM refresh_tokens WHERE token = $1', [oldHash]);

    const newRawRefresh = issueRefreshToken();
    const newHash = hashRefreshToken(newRawRefresh);
    const expiresAt = buildRefreshExpiry({ settings });

    await client.query(
      `INSERT INTO refresh_tokens (token, user_id, expires_at)
       VALUES ($1, $2, $3)`,
      [newHash, user.id, expiresAt]
    );

    await client.query('COMMIT');

    const accessToken = issueAccessToken({ userId: user.id, role: user.role, settings });

    return res.json({
      success: true,
      access_token: accessToken,
      refresh_token: newRawRefresh,
      token_type: 'Bearer',
      expires_in: '15m'
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error('❌ Refresh error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  } finally {
    if (client) client.release();
  }
};

module.exports.logout = ({ pool }) => async (req, res) => {
  try {
    const { refresh_token: rawRefresh } = req.body;
    if (!rawRefresh) {
      return res.status(400).json({ success: false, message: 'refresh_token is required' });
    }

    const hash = hashRefreshToken(rawRefresh);
    await pool.query('DELETE FROM refresh_tokens WHERE token = $1', [hash]);

    return res.json({ success: true, message: 'Logged out' });
  } catch (error) {
    console.error('❌ Logout error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports.validate = ({ pool }) => async (req, res) => {
  try {
    const authHeader = req.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Missing bearer token' });
    }

    const token = authHeader.slice(7);
    const payload = verifyAccessToken(token);

    const userRes = await pool.query('SELECT id, role FROM users WHERE id = $1', [payload.sub]);
    if (userRes.rowCount === 0) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    res.setHeader('x-user-id', payload.sub);
    res.setHeader('x-user-role', userRes.rows[0].role);
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

module.exports.jwks = ({ settings }) => async (req, res) => {
  try {
    return res.json(getJwks({ kid: settings.jwtKid }));
  } catch (error) {
    console.error('❌ JWKS error:', error);
    return res.status(500).json({ success: false, message: 'JWKS unavailable' });
  }
};

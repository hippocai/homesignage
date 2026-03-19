const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const userDao = require('../dao/userDao');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const JWT_EXPIRES_IN = '24h';

async function login(req, res) {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const user = await userDao.findByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    logger.info('User logged in', { username: user.username });

    return res.json({
      data: {
        token,
        user: { id: user.id, username: user.username, role: user.role }
      },
      message: 'Login successful'
    });
  } catch (err) {
    logger.error('Login error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function verify(req, res) {
  // The authenticateJWT middleware already validated the token
  return res.json({
    data: { user: req.user },
    message: 'Token is valid'
  });
}

async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  try {
    const user = await userDao.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) {
      return res.status(400).json({ error: '当前密码不正确' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await userDao.updatePassword(user.id, hashed);

    logger.info('Password changed', { userId: user.id });
    return res.json({ message: '密码已修改成功' });
  } catch (err) {
    logger.error('Change password error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { login, verify, changePassword };

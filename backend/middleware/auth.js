const jwt = require('jsonwebtoken');
const User = require('../models/User');

async function protect(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({ message: 'User no longer exists' });
    }

    if (user.passwordChangedAt) {
      const changedTimeMs = user.passwordChangedAt.getTime();
      // If token includes high-precision millisecond timestamp (iatMs):
      // Invalidate if issued at or before the password change timestamp.
      if (typeof decoded.iatMs === 'number') {
        if (decoded.iatMs <= changedTimeMs) {
          return res.status(401).json({ message: 'Password recently changed. Please log in again.' });
        }
      } else if (typeof decoded.iat === 'number') {
        // For standard second-resolution JWTs without iatMs:
        // Any token with iat second less than or equal to the password change second
        // was issued before or during the boundary second.
        const changedSec = Math.floor(changedTimeMs / 1000);
        if (decoded.iat <= changedSec) {
          return res.status(401).json({ message: 'Password recently changed. Please log in again.' });
        }
      }
    }

    req.user = user; req.jwt = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

module.exports = { protect };

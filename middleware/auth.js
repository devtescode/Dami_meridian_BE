// This project is CommonJS (package.json has no "type": "module"), so this file
// MUST use require/module.exports. It used to be written with ESM `export`
// syntax, which made `require("../middleware/auth")` throw
// "SyntaxError: Unexpected token 'export'" and left every write route
// unprotected. Do not convert it back to ESM.
const jwt = require("jsonwebtoken");

// Verifies the admin JWT sent as `Authorization: Bearer <token>` and attaches
// the decoded payload to `req.admin`; rejects with 401 if the token is
// missing, invalid, or expired.
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

module.exports = { verifyToken };

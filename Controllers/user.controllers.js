const jwt = require("jsonwebtoken")
const env = require("dotenv")
const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")
const Admin  = require("../Models/user.models");
env.config()


// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// The admin panel enforces 8 characters, but the browser is not a security
// boundary: the API is. The same rule is enforced here so that a crafted
// request can never set a one character password.
const MIN_PASSWORD_LENGTH = 8;

// Emails are stored and compared in lower case so that "Admin@Example.com"
// and "admin@example.com" are the same account.
const normalizeEmail = (value) => String(value ?? "").trim().toLowerCase();

// Escapes a value before it is embedded in a RegExp.
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Deliberately lenient shape check: one "@" and no whitespace. It rejects
// obviously bogus input without rejecting unusual but legal addresses.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

const isValidEmail = (value) => EMAIL_PATTERN.test(String(value ?? ""));

// A bcrypt hash of a random throw-away password. It is used to keep the
// response time of a login attempt for an unknown email roughly the same as
// for a known email (see the login handler), so the timing does not leak
// which email addresses exist.
const DUMMY_HASH = "$2b$10$2TJasFDjaE5seXsvawyODu.gqY8U7dYufVpfAlZogOoat27tPOoom";


// ---------------------------------------------------------------------------
// Login rate limiting (self contained, no extra dependency)
// ---------------------------------------------------------------------------

// Failed login attempts are tracked per IP address in memory:
//   - LOGIN_WINDOW_MS: how long the window stays open
//   - LOGIN_MAX_ATTEMPTS: how many failures are tolerated inside a window
//   - MAX_TRACKED_IPS: defensive cap so the Map can never grow without bound
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_MAX_ATTEMPTS = 10; // failed attempts allowed per IP per window
const MAX_TRACKED_IPS = 5000; // hard cap on the number of tracked IPs

// ip -> { count, windowStart }
const loginAttempts = new Map();

// Best effort client identity. `req.ip` is used when available, the socket
// address is the fallback.
const getClientKey = (req) => {
  const ip =
    req?.ip ||
    req?.socket?.remoteAddress ||
    req?.connection?.remoteAddress ||
    "unknown";
  return String(ip);
};

// Removes expired windows and enforces the maximum Map size. Called on every
// login attempt, so stale entries never pile up.
const pruneLoginAttempts = (now = Date.now()) => {
  for (const [key, entry] of loginAttempts) {
    if (!entry || now - entry.windowStart >= LOGIN_WINDOW_MS) {
      loginAttempts.delete(key);
    }
  }

  // Defensive cap: Map preserves insertion order, so the oldest entries are
  // dropped first when too many different IPs are being tracked.
  while (loginAttempts.size > MAX_TRACKED_IPS) {
    const oldest = loginAttempts.keys().next();
    if (oldest.done) break;
    loginAttempts.delete(oldest.value);
  }
};

// True when this client already burned through its allowance.
const isLoginBlocked = (key, now = Date.now()) => {
  const entry = loginAttempts.get(key);
  if (!entry) return false;

  if (now - entry.windowStart >= LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return false;
  }

  return entry.count >= LOGIN_MAX_ATTEMPTS;
};

// Counts one failed attempt, starting a fresh window when needed.
const registerFailedLogin = (key, now = Date.now()) => {
  const entry = loginAttempts.get(key);

  if (!entry || now - entry.windowStart >= LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, windowStart: now });
    return;
  }

  entry.count += 1;
  loginAttempts.set(key, entry);
};

// A successful login wipes the counter for that IP.
const clearFailedLogins = (key) => {
  loginAttempts.delete(key);
};

/**
 * Rate limiting middleware for the login route.
 *
 * `Routes/user.routes.js` mounts the controller directly, so the limiter is
 * applied by wrapping the handler instead of adding a route middleware there.
 * When the client exceeded the allowance the request is answered with 429 and
 * the wrapped handler is never reached.
 */
const loginRateLimiter = (req, res, next) => {
  const key = getClientKey(req);
  req.loginRateKey = key;

  pruneLoginAttempts();

  if (isLoginBlocked(key)) {
    return res.status(429).json({
      message: "Too many login attempts. Please try again later.",
    });
  }

  next();
};

const withLoginRateLimit = (handler) => (req, res, next) => {
  let pending;
  loginRateLimiter(req, res, () => {
    pending = Promise.resolve(handler(req, res, next));
    // Hand a rejected handler over to the Express error handler.
    pending.catch(next);
  });
  // Returning the promise keeps Express 5's async error handling working.
  return pending;
};


module.exports.userwelcome = async (req, res) => {
    res.status(200).json({ message: "Welcome to DAMI MERIDIAN" })
}

module.exports.status = async (req, res) => {
    try {
        const admin = await Admin.findOne();
        if (admin) {
            return res.json({ adminExists: true });
        } else {
            return res.json({ adminExists: false });
        }
    } catch (err) {
        // A database outage must be visible in the server logs, and the client
        // must not receive an empty 200 (it would look like "no admin yet").
        console.error("Status check error:", err);
        return res.status(500).json({ message: "Could not reach the server." });
    }
}


module.exports.register = async (req, res) => {
    try {
        // A bodyless request leaves `req.body` undefined, so it always goes
        // through a fallback object.
        const body = req.body ?? {};

        const email = normalizeEmail(body.email);
        const password = String(body.password ?? "");

        if (!email || !isValidEmail(email)) {
            return res.status(400).json({ message: "A valid email address is required." });
        }

        if (!password || password.length < MIN_PASSWORD_LENGTH) {
            return res.status(400).json({
                message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
            });
        }

        const existing = await Admin.findOne();

        if (existing) {
            return res.status(400).json({ message: "Admin already exists" });
        }

        // No hashing here on purpose: the Admin model's pre('save') hook hashes the
        // password for us, so we store the raw password we receive from the client.
        // Hashing it here as well would hash the hash and make every login fail.
        const admin = new Admin({
            email: email,
            password: password,
        });

        await admin.save();
        console.log("Admin created successfully");

        res.json({ message: "Admin created successfully" });
    } catch (err) {
        // Duplicate email: the unique index rejected the insert.
        if (err && err.code === 11000) {
            return res.status(409).json({ message: "Admin already exists" });
        }

        // Schema validation failed (missing/oversized field, ...).
        if (err && err.name === "ValidationError") {
            return res.status(400).json({ message: "Invalid admin details." });
        }

        console.error("Register error:", err);
        res.status(500).json({ message: "Server error" });
    }
}


const loginHandler = async (req, res) => {
    try {
        // `req.body` is undefined for a bodyless request -> never touch it
        // directly, always go through the fallback.
        const body = req.body ?? {};

        const email = normalizeEmail(body.email);
        const password = String(body.password ?? "");

        // Validate BEFORE querying. `Admin.findOne({ email: undefined })` would
        // be stripped to `findOne({})` by Mongoose and load the first admin
        // document in the collection.
        if (!email || !password) {
            return res.status(400).json({ message: "Email and password are required." });
        }

        // Look the admin up by the validated (lower cased) email. The case
        // insensitive fallback keeps the lookup working when the stored email
        // was written with a different casing.
        let admin = await Admin.findOne({ email: email });

        if (!admin) {
            admin = await Admin.findOne({
                email: new RegExp(`^${escapeRegExp(email)}$`, "i"),
            });
        }

        const clientKey = req.loginRateKey || getClientKey(req);

        if (!admin) {
            // Unknown email: run a dummy comparison so the response time is
            // similar to the "wrong password" case (no timing oracle), then
            // answer with the very same generic message.
            await bcrypt.compare(password, DUMMY_HASH);
            registerFailedLogin(clientKey);
            return res.status(400).json({ message: "Incorrect email or password." });
        }

        const isMatch = await bcrypt.compare(
            password,
            admin.password
        );

        if (!isMatch) {
            registerFailedLogin(clientKey);
            return res.status(400).json({ message: "Incorrect email or password." });
        }

        // Successful login: forget the failed attempts for this IP.
        clearFailedLogins(clientKey);

        const token = jwt.sign(
            { id: admin._id, email: admin.email },
            process.env.JWT_SECRET,
            { expiresIn: "1hr" }
        );

        res.json({ token });
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ message: "Server error" });
    }

}

// The rate limiter is applied around the handler (see withLoginRateLimit).
module.exports.login = withLoginRateLimit(loginHandler);


module.exports.changePassword = async (req, res) => {
  try {
    // `req.body` is undefined for a bodyless request -> never touch it
    // directly, always go through the fallback.
    const body = req.body ?? {}

    const currentPassword = String(body.currentPassword ?? "")
    const newPassword = String(body.newPassword ?? "")

    if (!currentPassword) {
      return res.status(400).json({
        message: 'Current password is required.',
      })
    }

    // A too short new password would lock the admin out for good.
    if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        message: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      })
    }

    // Only the authenticated admin may change its own password. `req.admin`
    // is the decoded JWT payload (id + email) set by middleware/auth.js.
    const adminId = req.admin?.id

    if (!adminId || !mongoose.isValidObjectId(String(adminId))) {
      return res.status(404).json({
        message: 'Admin not found',
      })
    }

    // FIND ADMIN (the authenticated one, never "the first admin in the db")
    const admin = await Admin.findById(adminId)

    if (!admin) {
      return res.status(404).json({
        message: 'Admin not found',
      })
    }

    // CHECK CURRENT PASSWORD
    const isMatch = await bcrypt.compare(
      currentPassword,
      admin.password
    )

    if (!isMatch) {
      // Early return: this MUST stop the function so we never fall through and
      // overwrite the password with newPassword after a failed check.
      return res.status(400).json({
        message: 'Current password is incorrect',
      })
    }

    // ✅ JUST SET NEW PASSWORD
    // pre('save') will hash automatically
    admin.password = newPassword

    await admin.save()

    res.status(200).json({
      message: 'Password updated successfully',
    })
    console.log("Password updated successfully");

  } catch (err) {
    console.error("Change password error:", err)

    res.status(500).json({
      message: 'Server Error',
    })
  }
}

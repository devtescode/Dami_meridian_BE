const express = require("express")
const { userwelcome, status, register, login, changePassword } = require("../Controllers/user.controllers")
const { verifyToken } = require("../middleware/auth")
const router = express.Router()

router.get('/welcome', userwelcome)
router.get("/status", status)
router.post("/register", register)
router.post("/login", login)
router.put("/changepassword", verifyToken, changePassword)

module.exports = router

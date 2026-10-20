const express = require("express")
const { getallproducts, getproductbyid, addproducts, editproducts, deleteproducts } = require("../Controllers/user.controllersproduct")
const { verifyToken } = require("../middleware/auth")
const router = express.Router()
const upload = require("../middleware/upload");

// Public read
router.get("/getallproducts", getallproducts)
router.get("/products/:id", getproductbyid)

// Protected writes
router.post("/addproducts", verifyToken, upload.array("images"), addproducts)
router.put("/editproducts/:id", verifyToken, upload.array("images"), editproducts)
router.delete("/deleteproducts/:id", verifyToken, deleteproducts)

module.exports = router

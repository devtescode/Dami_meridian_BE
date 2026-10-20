   




const jwt = require("jsonwebtoken")
const env = require("dotenv")
const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")
// const { default: axios } = require("axios")
const Product = require("../Models/modelProduct");
const uploadImage = require("../utils/uploadImage");
// const ADMIN_SECRET_KEY = process.env.JWT_SECRET_KEY
// const cloudinary = require('cloudinary').v2;
env.config()

/**
 * Multipart fields arrive as strings. Collections of options are sent as a
 * JSON array; anything malformed is ignored rather than rejected.
 */
const parseListField = (value) => {
    if (!value) return []
    if (Array.isArray(value)) return value.filter(Boolean)
    try {
        const parsed = JSON.parse(value)
        return Array.isArray(parsed) ? parsed.filter(Boolean) : []
    } catch {
        return []
    }
}

/**
 * The two closed vocabularies the Product schema enforces. They are listed
 * here as well so the request can be checked *before* it reaches Mongoose:
 * a bad value is a client mistake (400), not a server fault (500).
 */
const PRODUCT_CATEGORIES = ["In Stock", "Out of Stock", "Coming Soon", "Made to Order"]
const PRODUCT_COLLECTIONS = ["men-tshirts", "women-tshirts", "joggers", "perfumes", "jewellery"]

// Used when the field is not sent at all — the same defaults the schema applies.
const DEFAULT_CATEGORY = "In Stock"
const DEFAULT_COLLECTION = "jewellery"

/**
 * `existingImages` is sent either as a single URL or as an array when the
 * same multipart field is repeated.
 */
const parseExistingImages = (value) => {
    if (!value) return []
    const list = Array.isArray(value) ? value : [value]
    return list.filter((item) => typeof item === "string" && item.trim() !== "")
}

/**
 * Validates the fields the admin panel submits.
 *
 * @param {object} body the (possibly empty) request body
 * @returns {{ error: string } | { value: { name: string, price: number, category: string, collection: string } }}
 */
const validateProductInput = (body) => {
    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (!name) {
        return { error: "Product name is required." }
    }

    let price = NaN
    if (typeof body.price === "number") {
        price = body.price
    } else if (typeof body.price === "string" && body.price.trim() !== "") {
        price = Number(body.price)
    }
    if (!Number.isFinite(price) || price <= 0) {
        return { error: "Price must be a number greater than 0." }
    }

    // An absent field falls back to the schema default; a field that *is*
    // sent has to be one of the allowed values.
    const rawCategory = body.category
    const category =
        rawCategory === undefined || rawCategory === null
            ? DEFAULT_CATEGORY
            : String(rawCategory).trim()
    if (!PRODUCT_CATEGORIES.includes(category)) {
        return { error: `Category must be one of: ${PRODUCT_CATEGORIES.join(", ")}.` }
    }

    const rawCollection = body.collection
    const collection =
        rawCollection === undefined || rawCollection === null
            ? DEFAULT_COLLECTION
            : String(rawCollection).trim()
    if (!PRODUCT_COLLECTIONS.includes(collection)) {
        return { error: `Collection must be one of: ${PRODUCT_COLLECTIONS.join(", ")}.` }
    }

    return { value: { name, price, category, collection } }
}

/**
 * Turns a Mongoose ValidationError into a short, client facing message.
 * The raw error text ("Cast to Number failed for value ...") is Mongoose
 * internal wording and must never reach the admin panel.
 */
const describeValidationError = (err) => {
    const fields = Object.keys(err && err.errors ? err.errors : {})
    if (!fields.length) return "Invalid product data."
    return `Invalid product data: ${fields.join(", ")}.`
}

/**
 * Maps an error that escaped the pre-validation onto the right status code.
 * Returns null for genuine server faults, which are logged and answered with
 * a generic message.
 */
const clientErrorFor = (err) => {
    if (!err) return null
    if (err.name === "ValidationError") {
        return { status: 400, message: describeValidationError(err) }
    }
    if (err.name === "CastError") {
        return { status: 400, message: "Invalid value for one of the product fields." }
    }
    return null
}

module.exports.userwelcome = async (req, res) => {
    res.status(200).json({ message: "Welcome to DAMI MERIDIAN" })
}

module.exports.getallproducts = async (req, res) => {
    try {
        const products = await Product.find().sort({ createdAt: -1 });
        res.json(products);
    } catch (err) {
        console.error("Error fetching products:", err);
        res.status(500).json({ message: "Error fetching products" });
    }
}

module.exports.getproductbyid = async (req, res) => {
    try {
        // A malformed id would blow up inside the query with a CastError;
        // check it up front so the client gets a proper 400.
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: "Invalid product id." });
        }

        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ message: "Product not found" });
        }

        res.json(product);
    } catch (err) {
        const clientError = clientErrorFor(err);
        if (clientError) {
            return res.status(clientError.status).json({ message: clientError.message });
        }
        console.error("Error fetching product:", err);
        res.status(500).json({ message: "Error fetching product" });
    }
}

module.exports.addproducts = async (req, res) => {
    // `req.body` is undefined when the request carries no body at all
    // (body-parser 2.x leaves it undefined) — never dereference it blindly.
    const body = req.body ?? {};

    try {
        // Validate first: a bad field is a client error and must not reach
        // the database (nor trigger an upload we would only throw away).
        const { error, value } = validateProductInput(body);
        if (error) {
            return res.status(400).json({ message: error });
        }

        // Images the admin panel already had (single URL or repeated
        // multipart field) first, newly uploaded files appended after them.
        let imageURLs = parseExistingImages(body.existingImages);

        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const result = await uploadImage(file.buffer);
                imageURLs.push(result.secure_url);
            }
        }

        const product = new Product({
            name: value.name,
            price: value.price,
            description: body.description,
            category: value.category,
            collection: value.collection,
            sizes: parseListField(body.sizes),
            colors: parseListField(body.colors),
            fragranceNotes: body.fragranceNotes || "",
            volume: body.volume || "",
            imageURLs, // store as array
        });

        await product.save();

        console.log("Product saved");
        res.json(product);
    } catch (err) {
        const clientError = clientErrorFor(err);
        if (clientError) {
            return res.status(clientError.status).json({ message: clientError.message });
        }
        console.error("Error adding product:", err);
        res.status(500).json({ message: "Something went wrong while saving the product." });
    }
};

module.exports.editproducts = async (req, res) => {
    const body = req.body ?? {};

    try {
        // A malformed id would blow up inside the query with a CastError;
        // check it up front so the admin gets a proper 400.
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: "Invalid product id." });
        }

        // A well formed id that matches nothing is "not found", not a
        // validation error, so the existence check comes before validation.
        const existing = await Product.findById(req.params.id).lean();
        if (!existing) {
            return res.status(404).json({ message: "Product not found" });
        }

        const { error, value } = validateProductInput(body);
        if (error) {
            return res.status(400).json({ message: error });
        }

        const updateData = {
            name: value.name,
            // Coerce to a real number — an empty string must not be stored
            // as `null` by the cast.
            price: Number(value.price),
            description: body.description,
            category: value.category,
            collection: value.collection,
            sizes: parseListField(body.sizes),
            colors: parseListField(body.colors),
            fragranceNotes: body.fragranceNotes || "",
            volume: body.volume || "",
        };

        const existingImages = parseExistingImages(body.existingImages);

        let newImageURLs = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const result = await uploadImage(file.buffer);
                newImageURLs.push(result.secure_url);
            }
        }
        updateData.imageURLs = [...existingImages, ...newImageURLs];

        const updated = await Product.findByIdAndUpdate(
            req.params.id,
            updateData,
            // `runValidators` makes Mongoose apply `required` and `enum`
            // on the update as well — without it a corrupt product can be
            // written straight into the database.
            { new: true, runValidators: true }
        );

        if (!updated) {
            return res.status(404).json({ message: "Product not found" });
        }

        res.json(updated);
    } catch (err) {
        const clientError = clientErrorFor(err);
        if (clientError) {
            return res.status(clientError.status).json({ message: clientError.message });
        }
        console.error("Error updating product:", err);
        res.status(500).json({ message: "Something went wrong while updating the product." });
    }
};

module.exports.deleteproducts = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: "Invalid product id." });
        }

        const deleted = await Product.findByIdAndDelete(req.params.id);

        if (!deleted) {
            return res.status(404).json({ message: "Product not found" });
        }

        res.json({ message: "Product deleted" });
    } catch (err) {
        const clientError = clientErrorFor(err);
        if (clientError) {
            return res.status(clientError.status).json({ message: clientError.message });
        }
        console.error("Error deleting product:", err);
        res.status(500).json({ message: "Something went wrong while deleting the product." });
    }
}

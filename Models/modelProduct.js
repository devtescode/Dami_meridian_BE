




// models/Product.js
const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    imageURLs: [String], // array of image URLs
    price: { type: Number, required: true },
    description: String,

    /**
     * Availability. Unchanged from the original schema so existing
     * records keep working.
     */
    category: {
      type: String,
      enum: ["In Stock", "Out of Stock", "Coming Soon", "Made to Order"],
      default: "In Stock",
    },

    /**
     * Product group. Added for the DAMI MERIDIAN rebrand.
     * Existing records have no value, so Mongoose falls back to the
     * "jewellery" default — the pre-rebrand product line.
     */
    collection: {
      type: String,
      enum: [
        "men-tshirts",
        "women-tshirts",
        "joggers",
        "perfumes",
        "jewellery",
      ],
      default: "jewellery",
    },

    /** Optional apparel options — only rendered when the product has them. */
    sizes: { type: [String], default: [] },
    colors: { type: [String], default: [] },

    /** Optional fragrance details — only rendered when the product has them. */
    fragranceNotes: { type: String, default: "" },
    volume: { type: String, default: "" },
  },
  {
    timestamps: true,
    // `collection` is a reserved Mongoose schema pathname, so the schema
    // warns about it on every startup. The field itself works correctly —
    // only the warning needs silencing. This has to be a SCHEMA option,
    // not a model option, or Mongoose ignores it.
    suppressReservedKeysWarning: true,
  }
);

module.exports = mongoose.model("Product", productSchema);

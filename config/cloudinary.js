const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  // Serve every asset over HTTPS explicitly instead of relying on the SDK
  // default, so an image URL can never be handed out over plain HTTP.
  secure: true,
});

module.exports = cloudinary;
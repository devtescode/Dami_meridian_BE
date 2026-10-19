const cloudinary = require("../config/cloudinary");

const uploadImage = (buffer) => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      // Target folder for NEW uploads. This is only a destination directory inside
      // Cloudinary - existing product image URLs already point at the old
      // "jewelry-products" folder and keep working regardless of this value.
      // resource_type + allowed_formats pin the server side allowlist: even if
      // something non-image ever reached this point, Cloudinary refuses to
      // store it instead of auto-detecting a format and serving it (an HTML
      // or script-capable SVG would be served from the Cloudinary domain).
      .upload_stream(
        {
          folder: "dami-meridian-products",
          resource_type: "image",
          allowed_formats: ["jpg", "jpeg", "png"],
        },
        (err, result) => {
          if (err) return reject(err);
          resolve(result);
        }
      ).end(buffer);
  });
};

module.exports = uploadImage;
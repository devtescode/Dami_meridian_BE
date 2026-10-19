// CommonJS (see ../middleware/auth.js): require/module.exports only.
const multer = require("multer");

// --- Upload policy ----------------------------------------------------------
// The admin panel already rejects anything that is not PNG/JPEG and anything
// over 5 MB, but client-side validation is NOT a security boundary: a hand
// crafted multipart request skips the browser entirely. The server has to
// enforce the very same rules, otherwise `multer.memoryStorage()` buffers an
// arbitrarily large upload in RAM and takes the whole process down (denial of
// service on a hosted service).
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB per file
const MAX_FILES = 10; // at most 10 files per request
const MAX_FILE_SIZE_MB = MAX_FILE_SIZE / (1024 * 1024);
const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/jpg"];

// Content types that carry no format information. They are NOT rejected on
// the header alone: the bytes decide what the file is. A real PNG sent as
// "application/octet-stream" (or with no Content-Type at all, which busboy
// reports as "text/plain") is still a real PNG and has to be accepted.
const AMBIGUOUS_MIME_TYPES = [
  "application/octet-stream",
  "binary/octet-stream",
  "text/plain",
];

// --- Multipart limits -------------------------------------------------------
// Multer forwards these straight to busboy. `fields` and `parts` are UNBOUNDED
// by default, and every text field value is kept in `req.body`, so a request
// carrying hundreds of 1 MB fields made the heap grow ~4.4x and killed the
// process (measured against this code path: 600 x 1 MB fields took RSS from
// 57 MB to 1.9 GB and the connection died). A bounded field/part count is
// exactly what stops that amplification.
const MAX_FIELDS = 40; // text fields per request (~9 from the form, plus one
                      // `existingImages` field per already-stored image, so a
                      // product that has accumulated many photos still fits)
const MAX_PARTS = 50; // files + text fields per request
const MAX_FIELD_SIZE = 64 * 1024; // per text field (busboy's own default is 1 MB)
const MAX_FIELD_NAME_SIZE = 100; // field names are short keys
const MAX_HEADER_PAIRS = 2000; // multipart header pairs per part (busboy caps these at 2000 itself)

// --- Content sniffing -------------------------------------------------------
// `file.mimetype` is the Content-Type the client sent, so it proves nothing:
// an HTML file or an SVG carrying a <script> labelled "image/png" used to
// pass the filter, was uploaded to Cloudinary and was then served back as a
// script-capable document from the Cloudinary domain. The real format is the
// magic number at the start of the bytes, so that is what gets checked.
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

const startsWithSignature = (buffer, signature) =>
  buffer.length >= signature.length &&
  buffer.subarray(0, signature.length).equals(signature);

// The content is what counts: a file is only an allowed image if its bytes
// really are a PNG or a JPEG, whatever the client claimed in the header.
const isAllowedImageBuffer = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;
  return (
    startsWithSignature(buffer, PNG_SIGNATURE) ||
    startsWithSignature(buffer, JPEG_SIGNATURE)
  );
};

// Every rejection raised here is a 4xx the client can act on, so it is
// flagged as such and answered with a clean JSON body instead of an HTML
// error page.
const buildUploadError = (code, message) => {
  const err = new Error(message);
  err.code = code;
  err.status = 400;
  err.uploadError = true; // marks the error as a 4xx the client can act on
  return err;
};

const describeInvalidContent = (file) =>
  `The content of "${
    file.originalname || "unnamed file"
  }" is not a valid PNG or JPEG image. The file type is detected from the file content, so a file that is not really an image is rejected.`;

/**
 * Accepts only the image types the admin panel allows.
 * `cb(null, false)` would silently drop the file and let the request continue
 * with no feedback at all, so an Error is passed instead: it aborts the
 * upload and the client gets a 4xx that explains what was wrong.
 */
const fileFilter = (req, file, cb) => {
  const mimeType = String(file.mimetype || "")
    .toLowerCase()
    .split(";")[0]
    .trim();

  // Cheap first line: a declared type that cannot be an image is rejected
  // before a single byte is buffered. It is NOT what guarantees the content
  // is an image - the byte check below does.
  if (
    !ALLOWED_MIME_TYPES.includes(mimeType) &&
    !AMBIGUOUS_MIME_TYPES.includes(mimeType)
  ) {
    return cb(
      buildUploadError(
        "INVALID_FILE_TYPE",
        `Unsupported file type "${file.mimetype || "unknown"}" for "${
          file.originalname || "unnamed file"
        }". Only ${ALLOWED_MIME_TYPES.join(
          ", "
        )} images are accepted and each file must be ${MAX_FILE_SIZE_MB} MB or smaller.`
      )
    );
  }

  // Defence in depth for storage engines that hand the filter a buffered
  // file. With multer's memoryStorage the filter runs BEFORE the buffer
  // exists, so the authoritative check lives in the storage wrapper below.
  if (file.buffer && !isAllowedImageBuffer(file.buffer)) {
    return cb(buildUploadError("INVALID_FILE_CONTENT", describeInvalidContent(file)));
  }

  cb(null, true);
};

// The controller ships `file.buffer` to Cloudinary, so the file has to be
// held in memory -> keep memoryStorage.
const memoryStorage = multer.memoryStorage();

/**
 * Storage wrapper that validates the REAL bytes of every accepted file.
 *
 * Multer calls the fileFilter with a `file` that only carries
 * fieldname/originalname/encoding/mimetype (see multer/lib/make-middleware.js):
 * the buffer is filled in by the storage engine afterwards, so with
 * memoryStorage the filter can never see the content. Wrapping the engine is
 * therefore the only place where the actual bytes exist before the file is
 * handed to the controller, and it is the authoritative "is this really an
 * image?" gate.
 */
const storage = {
  _handleFile(req, file, cb) {
    memoryStorage._handleFile(req, file, (err, info) => {
      if (err) return cb(err);
      if (!isAllowedImageBuffer(info && info.buffer)) {
        return cb(
          buildUploadError("INVALID_FILE_CONTENT", describeInvalidContent(file))
        );
      }
      cb(null, info);
    });
  },
  _removeFile(req, file, cb) {
    memoryStorage._removeFile(req, file, cb);
  },
};

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE, // per file
    files: MAX_FILES, // per request
    fields: MAX_FIELDS, // text fields per request
    parts: MAX_PARTS, // files + text fields per request
    fieldSize: MAX_FIELD_SIZE, // per text field
    fieldNameSize: MAX_FIELD_NAME_SIZE, // per field name
    headerPairs: MAX_HEADER_PAIRS, // multipart header pairs per part
  },
  fileFilter,
});

// --- Turning multer errors into clean JSON responses ------------------------
// Multer aborts with errors such as LIMIT_FILE_SIZE / LIMIT_FILE_COUNT /
// LIMIT_UNEXPECTED_FILE. Unhandled they bubble up to Express' default error
// handler (an HTML page) or to the generic 500 handler in index.js, and the
// client never learns why the upload was rejected.
const MULTER_ERROR_MESSAGES = {
  LIMIT_FILE_SIZE: `Each file must be ${MAX_FILE_SIZE_MB} MB or smaller (only ${ALLOWED_MIME_TYPES.join(
    ", "
  )} images are accepted).`,
  LIMIT_FILE_COUNT: `You can upload at most ${MAX_FILES} files per request.`,
  LIMIT_UNEXPECTED_FILE:
    'Unexpected file field. Upload every image under the "images" field.',
  LIMIT_PART_COUNT: "Too many parts in the request.",
  LIMIT_FIELD_COUNT: `Too many form fields in the request (at most ${MAX_FIELDS} are allowed).`,
  LIMIT_FIELD_KEY: `A field name in the request is too long (at most ${MAX_FIELD_NAME_SIZE} characters are allowed).`,
  LIMIT_FIELD_NAME: `A field name in the request is too long (at most ${MAX_FIELD_NAME_SIZE} characters are allowed).`,
  LIMIT_FIELD_VALUE: `A field value in the request is too long (at most ${MAX_FIELD_SIZE} bytes are allowed).`,
  LIMIT_HEADER_PAIR:
    "Too many header lines in the request. The multipart headers are malformed or too large.",
  MISSING_FIELD_NAME: "A part of the request has no field name.",
  INVALID_FIELD_NAME: "A field name in the request is not valid.",
  LIMIT_FIELD_NESTING: "A field name in the request is nested too deeply.",
  LIMIT_FIELD_ARRAY_INDEX:
    "A field name in the request uses an array index that is too large.",
  STREAM_DESTROYED: "The upload was interrupted. Please try again.",
};

const isUploadError = (err) =>
  Boolean(err) &&
  (err.uploadError === true ||
    err.name === "MulterError" ||
    Object.prototype.hasOwnProperty.call(MULTER_ERROR_MESSAGES, err.code));

// Human readable, client facing explanation of an upload failure.
const describeUploadError = (err) => {
  if (err.code === "LIMIT_UNEXPECTED_FILE" && err.field) {
    return `Unexpected file field "${err.field}". Upload every image under the "images" field.`;
  }
  if (err.code === "LIMIT_FILE_SIZE" && err.filename) {
    return `File "${err.filename}" is too large. Each file must be ${MAX_FILE_SIZE_MB} MB or smaller (only ${ALLOWED_MIME_TYPES.join(
      ", "
    )} images are accepted).`;
  }
  if (MULTER_ERROR_MESSAGES[err.code]) return MULTER_ERROR_MESSAGES[err.code];
  return err.message || "The upload was rejected.";
};

// Writes a clean 400 JSON response. Returns false when the error is not an
// upload error (or the response already started) so the caller can pass it
// on to the regular error handling.
const sendUploadError = (res, err) => {
  if (!isUploadError(err) || res.headersSent) return false;
  res.status(400).json({
    message: describeUploadError(err),
    code: err.code || "UPLOAD_ERROR",
  });
  return true;
};

// Wraps a multer middleware so an upload failure becomes a clean 400 JSON
// response instead of Express' default HTML error page. `upload.array(...)`
// still returns a plain Express middleware, so the route files do not change.
const withUploadErrors = (middleware) =>
  function uploadMiddleware(req, res, next) {
    middleware(req, res, (err) => {
      if (!err) return next();
      if (!sendUploadError(res, err)) next(err);
    });
  };

// Shadow the multer factory methods on this instance with the wrapped ones,
// so `upload.array("images")` keeps its exact call signature and behaviour.
["single", "array", "fields", "any", "none"].forEach((method) => {
  const original = upload[method].bind(upload);
  upload[method] = (...args) => withUploadErrors(original(...args));
});

/**
 * Optional global error handler for upload failures.
 * The product routes are already safe on their own (see withUploadErrors),
 * but mounting this in index.js also catches any multer error raised outside
 * of those routes. Mount it after the routes and before the generic handler:
 *
 *   const upload = require("./middleware/upload");
 *   app.use(upload.handleUploadError);
 */
const handleUploadError = (err, req, res, next) => {
  if (sendUploadError(res, err)) return;
  next(err);
};

upload.handleUploadError = handleUploadError;

module.exports = upload;

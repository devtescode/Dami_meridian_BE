const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
require('dotenv').config();
const cors = require('cors');
const userRoutes = require('./Routes/user.routes');
const ProductRoutes = require('./Routes/user.productRoutes');
const upload = require('./middleware/upload');
// const Payment = require('./Routes/payments')
// const paystackroute = require('./Controllers/paystackWebhook');

// const cloudinary = require("./config/cloudinary"); 


const app = express();
const server = http.createServer(app); // Create the server instance
const PORT = process.env.PORT || 4000;
const URI = process.env.URI;

// Fail fast on a missing or weak JWT secret. Without it every protected route
// answers 401 and login answers 500, which is a very confusing state to debug
// in production. The secret is the only thing that signs the admin tokens, so
// at least 32 characters are required.
if (!process.env.JWT_SECRET || String(process.env.JWT_SECRET).length < 32) {
    throw new Error(
        'JWT_SECRET is missing or too short. Set JWT_SECRET in your environment to a random string of at least 32 characters before starting the server.'
    );
}

app.use(cors());
// The only JSON bodies this API accepts are login, register and change-password
// payloads, so a 200mb limit was pure attack surface. Product images travel as
// multipart and are capped separately in middleware/upload.js.
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

mongoose
    .connect(URI)
    .then(() => {
        console.log('Database connected successfully DAMI MERIDIAN Backend');
    })
    .catch((err) => {
        console.error('Database connection error:', err);
});


// app.use('/admin', userRoutes);
app.use('/admin', userRoutes);
app.use('/jewelry', ProductRoutes);


app.get('/', (req, res) => {
    res.status(200).json({ message: 'Welcome to DAMI MERIDIAN Backend'});
});

// Unknown routes: the frontend API client expects JSON, not Express' default
// HTML error page.
app.use((req, res) => {
    res.status(404).json({ message: 'Route not found.' });
});

// Multer errors raised outside of the product routes are turned into a clean
// 400 JSON response here; anything else is passed on to the error handler.
app.use(upload.handleUploadError);

app.use((err, req, res, next) => {
    // If the response already started we must not write to it again, otherwise
    // Node throws "Cannot set headers after they are sent".
    if (res.headersSent) return next(err);

    const rawStatus = Number(err.status || err.statusCode || 500);
    const status = rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500;

    console.error('Error:', err.message);

    // 4xx errors are actionable for the client (malformed JSON body = 400,
    // body too large = 413, unsupported upload type = 400, ...) so they keep
    // their own message. 5xx errors get a generic message so nothing about
    // the server internals leaks out.
    if (status < 500) {
        return res.status(status).json({ message: err.message || 'Bad Request' });
    }

    res.status(status).json({ message: 'Internal Server Error' });
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

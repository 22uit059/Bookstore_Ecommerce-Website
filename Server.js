require('dotenv').config(); // Load environment variables

const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3004;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
    .then(() => console.log('MongoDB connected...'))
    .catch(err => console.log('MongoDB connection error:', err));

// =========================
// Schemas and Models
// =========================

// Book Schema
const bookSchema = new mongoose.Schema({
    title: { type: String, required: true },
    author: { type: String, required: true },
    price: { type: Number, required: true },
    description: { type: String, required: true },
    imageUrl: { type: String, required: true },
    rating: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    feedbackList: [{ username: String, text: String }],
});

const Book = mongoose.model('Book', bookSchema);

// User Schema
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email:    { type: String, required: true, unique: true },
    password: { type: String, required: true },
    cart:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'Book' }],
    wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Book' }],
});

const User = mongoose.model('User', userSchema);

// =========================
// Authentication Middleware
// =========================

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) return res.status(401).json({ message: 'Access token missing' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid token' });
        req.user = user;
        next();
    });
};

// =========================
// Routes
// =========================

// -------- User Authentication --------

// User Registration Route
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        // Check if user already exists
        const existingUser = await User.findOne({ $or: [{ username }, { email }] });
        if (existingUser) return res.status(400).json({ message: 'Username or email already exists.' });

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create new user
        const user = new User({ username, email, password: hashedPassword });
        await user.save();
        res.status(201).json({ message: 'User registered successfully.' });
    } catch (error) {
        console.error('Error registering user:', error);
        res.status(500).json({ message: 'Error registering user.' });
    }
});

// User Login Route
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        // Find user
        const user = await User.findOne({ username });
        if (!user) return res.status(400).json({ message: 'Invalid credentials.' });

        // Compare passwords
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ message: 'Invalid credentials.' });

        // Generate JWT
        const token = jwt.sign(
            { userId: user._id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.status(200).json({ token });
    } catch (error) {
        console.error('Error logging in:', error);
        res.status(500).json({ message: 'Error logging in.' });
    }
});

// -------- Book Management --------

// Initial Book Data
const initialBooks = [
    {
        title: "Charlotte's Web",
        author: "E. B. White",
        price: 10.99,
        description: "Charlotte's Web is a beloved children's novel...",
        imageUrl: "https://example.com/charlottes_web.jpg",
    },
    {
        title: "Harry Potter",
        author: "J.K. Rowling",
        price: 12.99,
        description: "The Harry Potter series follows the journey of a young wizard...",
        imageUrl: "https://example.com/harry_potter.jpg",
    },
    // Add more book objects as needed
];

// Function to populate the database if empty
const populateBooks = async () => {
    try {
        const count = await Book.countDocuments();
        if (count === 0) {
            await Book.insertMany(initialBooks);
            console.log('Initial books have been added to the database.');
        } else {
            console.log('Books already exist in the database.');
        }
    } catch (error) {
        console.log('Error populating books:', error.message);
    }
};

// Call the populateBooks function after successful MongoDB connection
mongoose.connection.once('open', () => {
    populateBooks();
});

// Get all books
app.get('/api/books', async (req, res) => {
    try {
        const books = await Book.find();
        res.json(books);
    } catch (error) {
        console.error('Error fetching books:', error);
        res.status(500).send('Error fetching books: ' + error.message);
    }
});

// Submit feedback and rating for a book
app.post('/api/books/:id/feedback', authenticateToken, async (req, res) => {
    const { text, rating } = req.body;
    const username = req.user.username;

    try {
        const book = await Book.findById(req.params.id);
        if (!book) return res.status(404).send('Book not found');

        // Add feedback to the book
        book.feedbackList.push({ username, text });

        // Update rating
        if (rating && typeof rating === 'number') {
            book.rating = ((book.rating * book.ratingCount) + rating) / (book.ratingCount + 1);
            book.ratingCount++;
        }

        await book.save();
        res.json(book);
    } catch (error) {
        console.error('Error submitting feedback:', error);
        res.status(500).send('Error submitting feedback: ' + error.message);
    }
});

// Add a New Book Route
app.post('/api/books', authenticateToken, async (req, res) => {
    const { title, author, price, description, imageUrl } = req.body;

    // Validate required fields
    if (!title || !author || !price || !description || !imageUrl) {
        return res.status(400).send('All fields are required');
    }

    try {
        const newBook = new Book({
            title,
            author,
            price,
            description,
            imageUrl
        });

        const savedBook = await newBook.save();
        res.status(201).json(savedBook);
    } catch (error) {
        console.error('Error adding book:', error);
        res.status(500).send('Error adding book: ' + error.message);
    }
});

// -------- Cart Management --------

// Add a book to user's cart
app.post('/api/cart', authenticateToken, async (req, res) => {
    const { bookId } = req.body;

    if (!bookId) {
        return res.status(400).json({ message: 'bookId is required' });
    }

    try {
        const book = await Book.findById(bookId);
        if (!book) return res.status(404).json({ message: 'Book not found' });

        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ message: 'User not found' });

        // Check if book is already in cart
        if (user.cart.includes(bookId)) {
            return res.status(400).json({ message: 'Book already in cart' });
        }

        user.cart.push(bookId);
        await user.save();

        res.json({ message: 'Book added to cart', cart: user.cart });
    } catch (error) {
        console.error('Error adding to cart:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Remove a book from user's cart
app.delete('/api/cart/:bookId', authenticateToken, async (req, res) => {
    const { bookId } = req.params;

    try {
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ message: 'User not found' });

        const index = user.cart.indexOf(bookId);
        if (index === -1) {
            return res.status(400).json({ message: 'Book not in cart' });
        }

        user.cart.splice(index, 1);
        await user.save();

        res.json({ message: 'Book removed from cart', cart: user.cart });
    } catch (error) {
        console.error('Error removing from cart:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get user's cart
app.get('/api/cart', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).populate('cart');
        if (!user) return res.status(404).json({ message: 'User not found' });

        res.json({ cart: user.cart });
    } catch (error) {
        console.error('Error fetching cart:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// -------- Wishlist Management --------

// Add a book to user's wishlist
app.post('/api/wishlist', authenticateToken, async (req, res) => {
    const { bookId } = req.body;

    if (!bookId) {
        return res.status(400).json({ message: 'bookId is required' });
    }

    try {
        const book = await Book.findById(bookId);
        if (!book) return res.status(404).json({ message: 'Book not found' });

        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ message: 'User not found' });

        // Check if book is already in wishlist
        if (user.wishlist.includes(bookId)) {
            return res.status(400).json({ message: 'Book already in wishlist' });
        }

        user.wishlist.push(bookId);
        await user.save();

        res.json({ message: 'Book added to wishlist', wishlist: user.wishlist });
    } catch (error) {
        console.error('Error adding to wishlist:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Remove a book from user's wishlist
app.delete('/api/wishlist/:bookId', authenticateToken, async (req, res) => {
    const { bookId } = req.params;

    try {
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ message: 'User not found' });

        const index = user.wishlist.indexOf(bookId);
        if (index === -1) {
            return res.status(400).json({ message: 'Book not in wishlist' });
        }

        user.wishlist.splice(index, 1);
        await user.save();

        res.json({ message: 'Book removed from wishlist', wishlist: user.wishlist });
    } catch (error) {
        console.error('Error removing from wishlist:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get user's wishlist
app.get('/api/wishlist', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).populate('wishlist');
        if (!user) return res.status(404).json({ message: 'User not found' });

        res.json({ wishlist: user.wishlist });
    } catch (error) {
        console.error('Error fetching wishlist:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// -------- Feedback Route --------

app.post('/api/feedback', (req, res) => {
    const { feedback } = req.body;
    console.log('Feedback received:', feedback);
    res.status(200).send('Feedback submitted successfully.');
});

// -------- Start the Server --------

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

const fs = require('fs');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
require('dotenv').config();

const connectDB = require('./config/db');
const User = require('./models/User');
const Metrics = require('./models/Metrics');
connectDB();

// const app = express();
// const server = http.createServer(app);
// const io = new Server(server, {
//   cors: corsOptions,
// });



const app = express();
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://localhost:3000',
      'https://social-media-dashboard-frontend1.netlify.app/',
      
    ];
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
};
const server = http.createServer(app);
const io = new Server(server, {
  cors: corsOptions,
});

mongoose.set('strictQuery', true);

app.use(cors(corsOptions));
io.cors = corsOptions;
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)){
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// Auth middleware
const auth = (req, res, next) => {
  try {
    const token = req.header('Authorization').replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Please authenticate' });
  }
};

// User registration endpoint
app.post('/register', async (req, res) => {
  console.log(req.body); // Check what data is received from the client
  try {
    const { username, email, password, fullName, dateOfBirth } = req.body;

    // Validate and process the data
    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = new User({ 
      username, 
      email, 
      password: hashedPassword, 
      fullName, 
      dateOfBirth
    });
    await newUser.save();
    res.status(201).json({ message: 'User created' });
  } catch (error) {
    console.error('Error during registration:', error);
    res.status(500).json({ message: 'Error registering user', error: error.message });
  }
});


// User login endpoint
app.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body; // Expect login (username or email) and password
    const user = await User.findOne({
      $or: [{ username: login }, { email: login }]
    });

    if (!user) return res.status(404).json({ message: 'User not found' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, username: user.username });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ message: 'Error logging in', error: error.message });
  }
});



// Get user details
app.get('/user', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching user details' });
  }
});

// Update user details
app.put('/user', auth, async (req, res) => {
  try {
    const { fullName, dateOfBirth } = req.body;
    const updatedUser = await User.findByIdAndUpdate(
      req.userId,
      { fullName, dateOfBirth },
      { new: true }
    ).select('-password');
    res.json(updatedUser);
  } catch (error) {
    res.status(500).json({ message: 'Error updating user details' });
  }
});

app.post('/upload-profile-pic', auth, upload.single('profilePic'), async (req, res) => {
  console.log('Received upload request');
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    console.log('File received:', req.file);
    const profilePicPath = path.relative(__dirname, req.file.path).replace(/\\/g, '/');
    const updatedUser = await User.findByIdAndUpdate(
      req.userId,
      { profilePic: profilePicPath },
      { new: true }
    ).select('-password');
    res.json(updatedUser);
  } catch (error) {
    console.error('Error uploading profile picture:', error);
    res.status(500).json({ message: 'Error uploading profile picture', error: error.message });
  }
});



app.get('/metrics', auth, async (req, res) => {
  try {
    const metrics = await Metrics.find({ userId: req.userId });
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching metrics' });
  }
});

// Add new metrics for a user
app.post('/metrics', auth, async (req, res) => {
  try {
    const { title, value, category } = req.body;
    const newMetrics = new Metrics({ title, value, category, userId: req.userId });
    await newMetrics.save();
    io.emit('dataUpdated', newMetrics);
    res.status(201).json(newMetrics);
  } catch (error) {
    console.error('Error adding metrics:', error);
    res.status(500).json({ message: 'Error adding metrics' });
  }
});


// Update metrics for a user
app.put('/metrics/:id', auth, async (req, res) => {
  try {
    const { value } = req.body;
    const updatedMetrics = await Metrics.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { value },
      { new: true }
    );
    if (!updatedMetrics) {
      return res.status(404).json({ message: 'Metric not found or unauthorized' });
    }
    io.emit('dataUpdated', updatedMetrics);
    res.json(updatedMetrics);
  } catch (error) {
    console.error('Error updating metrics:', error);
    res.status(500).json({ message: 'Error updating metrics' });
  }
});

// Delete metrics for a user
app.delete('/metrics/:id', auth, async (req, res) => {
  try {
    const deletedMetrics = await Metrics.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!deletedMetrics) {
      return res.status(404).json({ message: 'Metric not found or unauthorized' });
    }
    io.emit('dataUpdated', { id: req.params.id, deleted: true });
    res.json({ message: 'Metrics deleted' });
  } catch (error) {
    console.error('Error deleting metrics:', error);
    res.status(500).json({ message: 'Error deleting metrics' });
  }
});
// WebSocket setup
io.on('connection', (socket) => {
  console.log('a user connected');
  socket.on('disconnect', () => {
    console.log('user disconnected');
  });

  // Listen for data update events and broadcast to all connected clients
  socket.on('updateData', (data) => {
    io.emit('dataUpdated', data);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running with WebSocket on port ${PORT}`));
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// 1. CORS headers to allow cross-origin requests from preview iframe / IDE (port 3000 -> 3001)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// 2. JSON & URL-encoded body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3. Serve public assets (CSS, JS, images)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/views', express.static(path.join(__dirname, 'views')));
app.use(express.static(__dirname));

// 4. Page routes for views
app.get('/', (req, res) => {
  const viewsIndex = path.join(__dirname, 'views', 'index.html');
  const rootIndex = path.join(__dirname, 'index.html');
  res.sendFile(viewsIndex, (err) => {
    if (err) {
      res.sendFile(rootIndex, (err2) => {
        if (err2) {
          res.send(`<h2>Email Validator API Server is running on port ${PORT}</h2><p>POST /validate-email</p>`);
        }
      });
    }
  });
});

app.get('/success', (req, res) => {
  const viewsSuccess = path.join(__dirname, 'views', 'success.html');
  const rootSuccess = path.join(__dirname, 'sucess.html');
  res.sendFile(viewsSuccess, (err) => {
    if (err) {
      res.sendFile(rootSuccess, (err2) => {
        if (err2) res.redirect('/');
      });
    }
  });
});

// 5. POST route matching /validate-email
app.post('/validate-email', (req, res) => {
  const { email } = req.body || {};

  if (!email || typeof email !== 'string') {
    return res.status(400).json({
      status: 'error',
      message: 'Invalid email address format.'
    });
  }

  // Validate using the required regular expression
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isValid = emailRegex.test(email.trim());

  if (isValid) {
    return res.status(200).json({
      status: 'success',
      message: 'Email is valid!'
    });
  } else {
    return res.status(400).json({
      status: 'error',
      message: 'Invalid email address format.'
    });
  }
});

// 6. Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running and listening at http://localhost:${PORT}`);
  console.log(`📧 Email validation route ready: POST http://localhost:${PORT}/validate-email`);
});

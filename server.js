const express = require('express');
const app = express();
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
const multer = require('multer');
const ffmpeg = require('ffmpeg-static');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const router = express.Router();
require('dotenv').config();

// Environment variable validation
const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    console.warn(`Warning: Missing environment variable: ${varName}`);
  }
});

// CORS configuration for cloud deployment
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      'http://localhost:8081',
      'http://localhost:3000',
      'http://192.168.1.6:8081',
      'http://192.168.1.6:5000',
      'http://localhost:8082'
    ].filter(Boolean); // Remove undefined values
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// Force HTTPS in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}

app.use(bodyParser.json());

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = process.env.UPLOAD_PATH || path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'audio-' + uniqueSuffix + path.extname(file.originalname || '.m4a'));
  }
});

const upload = multer({ storage: storage });

// Setup MySQL connection with environment variables
const db = mysql.createConnection({
  host: process.env.DB_HOST || '88.150.227.117',
  user: process.env.DB_USER || 'nrktrn_web_admin',
  password: process.env.DB_PASSWORD || 'GOeg&*$*657',
  port: process.env.DB_PORT || '3306',
  database: process.env.DB_NAME || 'nrkindex_trn',
  auth_plugin: 'mysql_native_password',
  connect_timeout: 300,
});

db.connect((err) => {
  if (err) {
    console.error('Error connecting to MySQL:', err);
  } else {
    console.log('Connected to MySQL database.');
    console.log('Database host:', process.env.DB_HOST || '88.150.227.117');
  }
});

// Health check endpoint for cloud platforms
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Upload endpoint for audio files
app.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    console.log('Audio file uploaded:', req.file.filename);
    console.log('File path:', req.file.path);
    console.log('File extension:', path.extname(req.file.filename));
    
    const audioPath = req.file.path;
    const wavPath = audioPath.replace(/\.[^/.]+$/, '.wav');
    
    // Convert to WAV if needed (transcribe.py only supports WAV)
    if (!audioPath.toLowerCase().endsWith('.wav')) {
      console.log('Converting audio to WAV format...');
      console.log('Input file:', audioPath);
      console.log('Output file:', wavPath);
      console.log('FFmpeg path:', ffmpeg);
      
      exec(`"${ffmpeg}" -i "${audioPath}" "${wavPath}" -y`, (convertErr) => {
        if (convertErr) {
          console.error('FFmpeg conversion error:', convertErr);
          return res.status(500).json({ 
            error: 'Audio conversion failed: ' + convertErr.message,
            duration: 0
          });
        }
        
        console.log('Conversion successful, now transcribing WAV file');
        transcribeAudio(wavPath, res);
      });
    } else {
      // Already WAV, transcribe directly
      transcribeAudio(audioPath, res);
    }
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed: ' + error.message });
  }
});

function transcribeAudio(audioPath, res) {
  const transcribeScript = path.join(__dirname, 'transcribe.py');
  
  console.log('Calling transcribe script:', transcribeScript);
  console.log('Audio file path:', audioPath);
  
  exec(`python3 "${transcribeScript}" "${audioPath}"`, (err, stdout, stderr) => {
    console.log('Transcription stdout:', stdout);
    console.log('Transcription stderr:', stderr);
    console.log('Transcription error:', err);
    
    if (err) {
      console.error('Transcription error:', err);
      return res.status(500).json({ 
        error: 'Transcription failed: ' + err.message,
        duration: 0
      });
    }
    
    // Extract JSON from the output (the script outputs both logs and JSON)
    let result;
    try {
      // Find the JSON part in the output
      const jsonMatch = stdout.match(/\{[^}]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        // If no JSON found, create a basic result
        result = {
          transcription: stdout.trim().replace(/\n/g, ' '),
          duration: 0,
          error: 'No transcription result'
        };
      }
    } catch (parseError) {
      console.log('Could not parse JSON, treating as plain text');
      // Clean up the output for display
      const cleanText = stdout.trim().replace(/\n/g, ' ').replace(/Audio Duration:.*?seconds/, '').trim();
      result = {
        transcription: cleanText || 'Transcription failed',
        duration: 0,
        error: null
      };
    }
    
    console.log('Final result:', result);
    
    res.json({
      success: true,
      transcription: result.transcription || '',
      duration: result.duration || 0,
      error: result.error || null
    });
  });
}

// Login endpoint
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  console.log('Login attempt:', { username, password });
  
  db.query(
    'SELECT * FROM EMPLOY_REGISTRATION WHERE USERNAME = ? AND PASSWORD = ?',
    [username, password],
    (err, results) => {
      console.log('Query results:', { err, resultsCount: results?.length, firstResult: results?.[0] });
      
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'DB error: ' + err.message });
      }
      if (results.length === 0) {
        console.log('No user found with these credentials');
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      console.log('Login successful for user:', results[0].EMPNAME);
      console.log('🔍 Full user data being returned:', results[0]);
      console.log('🔍 EMPID in user data:', results[0].EMPID);
      res.json({ success: true, user: results[0] });
    }
  );
});

// Insert endpoint (original working endpoint)
app.post('/insert', (req, res) => {
  const { text_data, target_agent, target_column, username, password } = req.body;
  
  console.log('Received insert request:', { text_data, target_agent, target_column, username: username ? '***' : 'missing' });
  
  // Check if we have the required data to trigger Selenium
  if (!text_data || !target_agent) {
    return res.status(400).json({
      success: false,
      error: 'Missing text_data or target_agent'
    });
  }
  
  // Check if we have user credentials
  if (!username || !password) {
    return res.status(400).json({
      success: false,
      error: 'Missing user credentials (username/password)'
    });
  }

  // Get user EMPID first
  db.query(
    'SELECT EMPID FROM EMPLOY_REGISTRATION WHERE USERNAME = ? AND PASSWORD = ?',
    [username, password],
    (userErr, userResults) => {
      if (userErr) {
        console.error('User lookup error:', userErr);
        return res.status(500).json({ error: 'User lookup failed: ' + userErr.message });
      }
      
      if (userResults.length === 0) {
        return res.status(401).json({ error: 'Invalid user credentials' });
      }
      
      const userEmpId = userResults[0].EMPID;
      console.log('User EMPID:', userEmpId);

      // Save notification first
      const notificationData = {
        USER_ID: userEmpId,
        TITLE: `Selenium Report - ${target_agent}`,
        MESSAGE: `Processing request for ${target_agent} with data: ${text_data.substring(0, 100)}...`,
        TYPE: 'INFO',
        STATUS: 'PENDING',
        CREATED_AT: new Date(),
        UPDATED_AT: new Date()
      };

      db.query(
        'INSERT INTO MOB_NOTIFICATIONS SET ?',
        notificationData,
        (notifErr, notifResult) => {
          if (notifErr) {
            console.error('Notification save error:', notifErr);
            return res.status(500).json({ error: 'Failed to save notification: ' + notifErr.message });
          }
          
          console.log('Notification saved with ID:', notifResult.insertId);

          // Now run Selenium script
          const seleniumScript = path.join(__dirname, 'selenium_scripts', 'menu_add_report.py');
          const reportFile = path.join(__dirname, 'selenium_scripts', 'my_report.txt');
          
          // Write the text data to the report file
          fs.writeFileSync(reportFile, text_data);
          
          console.log('Calling Selenium script:', seleniumScript);
          console.log('Report file:', reportFile);
          
          exec(`python "${seleniumScript}"`, (err, stdout, stderr) => {
            console.log('Selenium stdout:', stdout);
            console.log('Selenium stderr:', stderr);
            console.log('Selenium error:', err);
            
            let success = false;
            let errorMessage = null;
            
            if (err) {
              console.error('Selenium execution error:', err);
              errorMessage = 'Selenium execution failed: ' + err.message;
            } else {
              // Check if the script completed successfully
              if (stdout.includes('SUCCESS') || !stderr) {
                success = true;
              } else {
                errorMessage = 'Selenium script did not complete successfully';
              }
            }
            
            // Update notification with result
            const updateData = {
              STATUS: success ? 'COMPLETED' : 'FAILED',
              MESSAGE: success 
                ? `Successfully processed ${target_agent} report`
                : `Failed to process ${target_agent} report: ${errorMessage}`,
              UPDATED_AT: new Date()
            };
            
            db.query(
              'UPDATE MOB_NOTIFICATIONS SET ? WHERE ID = ?',
              [updateData, notifResult.insertId],
              (updateErr) => {
                if (updateErr) {
                  console.error('Notification update error:', updateErr);
                }
                
                res.json({
                  success: success,
                  message: success ? 'Report processed successfully' : errorMessage,
                  notificationId: notifResult.insertId
                });
              }
            );
          });
        }
      );
    }
  );
});

// Get notifications endpoint
// app.get('/notifications/:userId', (req, res) => {
//   const userId = req.params.userId;
//   const page = parseInt(req.query.page) || 1;
//   const limit = parseInt(req.query.limit) || 10;
//   const offset = (page - 1) * limit;
  
//   console.log('Fetching notifications for user:', userId, 'page:', page, 'limit:', limit);
  
//   // Get total count
//   db.query(
//     'SELECT COUNT(*) as total FROM MOB_NOTIFICATIONS WHERE USER_ID = ? AND STATUS != "DELETED"',
//     [userId],
//     (countErr, countResults) => {
//       if (countErr) {
//         console.error('Count query error:', countErr);
//         return res.status(500).json({ error: 'Failed to get notification count: ' + countErr.message });
//       }
      
//       const total = countResults[0].total;
      
//       // Get notifications with pagination
//       db.query(
//         'SELECT * FROM MOB_NOTIFICATIONS WHERE USER_ID = ? AND STATUS != "DELETED" ORDER BY CREATED_AT DESC LIMIT ? OFFSET ?',
//         [userId, limit, offset],
//         (err, results) => {
//           if (err) {
//             console.error('Notifications query error:', err);
//             return res.status(500).json({ error: 'Failed to get notifications: ' + err.message });
//           }
          
//           console.log('Found notifications:', results.length);
          
//           res.json({
//             notifications: results,
//             pagination: {
//               page: page,
//               limit: limit,
//               total: total,
//               pages: Math.ceil(total / limit)
//             }
//           });
//         }
//       );
//     }
//   );
// });

app.get('/notifications/:userId', (req, res) => {
  console.log("====== /notifications API HIT ======");

  const userId = req.params.userId;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;

  console.log("Incoming Request:");
  console.log("User ID       :", userId);
  console.log("Query Params  :", req.query);
  console.log("Page          :", page);
  console.log("Limit         :", limit);
  console.log("Offset        :", offset);

  console.log("------------------------------------");
  console.log("Executing COUNT query with params:", [userId]);

  // Get total count
  db.query(
    'SELECT COUNT(*) as total FROM MOB_NOTIFICATIONS WHERE USER_ID = ? AND STATUS != "DELETED"',
    [userId],
    (countErr, countResults) => {

      if (countErr) {
        console.error("Count query ERROR:", countErr);
        return res.status(500).json({ error: 'Failed to get notification count: ' + countErr.message });
      }

      const total = countResults[0].total;

      console.log("COUNT result: total =", total);
      console.log("------------------------------------");
      console.log("Executing MAIN query:");
      console.log("SQL Params:", [userId, limit, offset]);

      // Get notifications with pagination
      db.query(
        'SELECT * FROM MOB_NOTIFICATIONS WHERE USER_ID = ? AND STATUS != "DELETED" ORDER BY CREATED_AT DESC LIMIT ? OFFSET ?',
        [userId, limit, offset],
        (err, results) => {

          if (err) {
            console.error("Notifications query ERROR:", err);
            return res.status(500).json({ error: 'Failed to get notifications: ' + err.message });
          }

          console.log("MAIN query returned", results.length, "rows");
          console.log("Sending Response...");
          console.log("====================================");

          res.json({
            notifications: results,
            pagination: {
              page: page,
              limit: limit,
              total: total,
              pages: Math.ceil(total / limit)
            }
          });
        }
      );
    }
  );
});


// Delete notification endpoint (soft delete)
app.delete('/notifications/:notificationId', (req, res) => {
  const notificationId = req.params.notificationId;
  
  console.log('Soft deleting notification:', notificationId);
  
  db.query(
    'UPDATE MOB_NOTIFICATIONS SET STATUS = "DELETED", UPDATED_AT = ? WHERE ID = ?',
    [new Date(), notificationId],
    (err, result) => {
      if (err) {
        console.error('Delete notification error:', err);
        return res.status(500).json({ error: 'Failed to delete notification: ' + err.message });
      }
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Notification not found' });
      }
      
      console.log('Notification soft deleted successfully');
      res.json({ success: true, message: 'Notification deleted successfully' });
    }
  );
});

// Mark notification as read
app.put('/notifications/:notificationId/read', (req, res) => {
  const notificationId = req.params.notificationId;
  
  console.log('Marking notification as read:', notificationId);
  
  db.query(
    'UPDATE MOB_NOTIFICATIONS SET IS_READ = 1, UPDATED_AT = ? WHERE ID = ?',
    [new Date(), notificationId],
    (err, result) => {
      if (err) {
        console.error('Mark as read error:', err);
        return res.status(500).json({ error: 'Failed to mark notification as read: ' + err.message });
      }
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Notification not found' });
      }
      
      console.log('Notification marked as read successfully');
      res.json({ success: true, message: 'Notification marked as read' });
    }
  );
});



// const { chromium } = require('playwright');

// async function sendMessageToRAG({ username, password, agent, text }) {
//   console.log('sendMessageToRAG called with:', { username: username ? '***' : 'missing', agent, text: text.substring(0, 30) + '...' });

//   const browser = await chromium.launch({ headless: true });
//   const page = await browser.newPage();

//   try {
//     // 1️⃣ Go to login page
//     console.log('Navigating to login page...');
//     await page.goto('https://myblocks.in/login', { timeout: 60000 });
//     await page.waitForLoadState('networkidle');
//     console.log('Login page loaded');

//     // 2️⃣ Fill login form
//     console.log('Filling login credentials...');
//     await page.fill('#username', username);
//     await page.fill('#password', password);
//     await page.selectOption('#userType', { value: 'BUSINESSAPP' }); // Business User

//     // 3️⃣ Click login
//     await page.click('#login-button');
//     console.log('Login submitted, waiting for main page...');

//     // 4️⃣ Wait for Business App link and click it
//     await page.waitForSelector('a[href="/businessuserhome"]', { timeout: 30000 });
//     console.log('Main page loaded, clicking Business App link...');
//     await page.click('a[href="/businessuserhome"]');

//     // 5️⃣ Navigate to RAG page
//     await page.waitForSelector('a[href="/rags"]', { timeout: 20000 });
//     console.log('Business App loaded, navigating to RAG...');
//     await page.click('a[href="/rags"]');

//     // 6️⃣ Select the agent
//     const agentSelector = `text=${agent}`;
//     await page.waitForSelector(agentSelector, { timeout: 15000 });
//     console.log(`Selecting agent: ${agent}`);
//     await page.click(agentSelector);

//     // 7️⃣ Enter user message
//     console.log('Locating chat input...');
//     const chatInput = await page.waitForSelector('textarea[placeholder="Ask a question..."]', { timeout: 15000 });
//     console.log('Filling chat input...');
//     await chatInput.fill(text);

//     // Press Enter to send the message
//     await chatInput.focus();
//     await page.keyboard.press('Enter');
//     console.log('Message sent, waiting for reply (up to 60s)...');

  
// // const chatMessagesSelector = 'div:has(svg.lucide-bot) > div.message-content';
// // let replyHTML = '';
// // const start = Date.now();
// // const timeout = 60000; // 60 seconds

// // while (Date.now() - start < timeout) {
// //   const messages = await page.locator(chatMessagesSelector).all();
// //   if (messages.length > 0) {
// //     // Grab last message and clean it
// //     replyHTML = await messages[messages.length - 1].evaluate(el => {
// //       // Clone the element so we can manipulate it safely
// //       const clone = el.cloneNode(true);

// //       // Remove buttons
// //       clone.querySelectorAll('button').forEach(b => b.remove());

// //       // Remove source/metadata divs (optional: adjust selector if needed)
// //       clone.querySelectorAll('div[style*="font-size"], div[style*="gap"]').forEach(d => d.remove());

// //       return clone.innerHTML.trim(); // return cleaned inner HTML
// //     });

// //     if (replyHTML.length > 0) break;
// //   }
// //   await page.waitForTimeout(1000); // poll every 1s
// // }

// // if (!replyHTML) {
// //   console.log('No reply received from RAG within 60 seconds.');
// //   replyHTML = '';
// // } else {
// //   console.log('Received bot reply (cleaned HTML):', replyHTML.substring(0, 300) + '...');
// // }

// // return replyHTML;

// // Count existing bot replies BEFORE sending message

// // 1️⃣ Count existing bot replies BEFORE sending message
// const chatMessagesSelector = 'div:has(svg.lucide-bot) > div.message-content';
// const oldCount = await page.locator(chatMessagesSelector).count();

// // 2️⃣ Send user message
// await chatInput.focus();
// await page.keyboard.press('Enter');
// console.log('Message sent, waiting for new bot reply (up to 60s)...');

// let replyText = '';
// const start = Date.now();
// const timeout = 60000;

// while (Date.now() - start < timeout) {
//   const messages = await page.locator(chatMessagesSelector).all();
//   const newCount = messages.length;

//   // ✅ Only proceed if a NEW message appeared
//   if (newCount > oldCount) {
//     const newMessage = messages[newCount - 1];

//     // Clean HTML (remove buttons, div metadata)
//     let rawHTML = await newMessage.evaluate(el => {
//       const clone = el.cloneNode(true);
//       clone.querySelectorAll('button').forEach(b => b.remove());
//       clone.querySelectorAll('div[style*="font-size"], div[style*="gap"]').forEach(d => d.remove());
//       return clone.innerHTML.trim();
//     });

//     // Strip all HTML → plain text
//     replyText = rawHTML.replace(/<[^>]+>/g, '').trim();

//     if (replyText.length > 0) break;
//   }

//   await page.waitForTimeout(500);
// }

// if (!replyText) {
//   console.log('No new bot reply received within 60 seconds.');
//   replyText = '';
// } else {
//   console.log('Received NEW bot reply (plain text):', replyText.substring(0, 200) + '...');
// }

// return replyText;




//   } catch (err) {
//     console.error('RAG chat error:', err);
//     throw err;
//   } finally {
//     await browser.close();
//   }
// }

// module.exports = { sendMessageToRAG };



// // Example: /rag-chat
// app.post('/rag-chat', async (req, res) => {
//   const { username, password, usertype, agent, text } = req.body;
  
//   if (!username || !password || !agent || !text) {
//     return res.status(400).json({ error: 'Missing parameters' });
//   }

//   try {
//     console.log('Received RAG chat request:', { username: username ? '***' : 'missing', agent, text: text.substring(0, 30) + '...' });  
//     const reply = await sendMessageToRAG({ username, password, usertype, agent, text });
//     res.json({ reply });
//   } catch (err) {
//     console.error('RAG chat error:', err);
//     res.status(500).json({ error: 'Failed to fetch RAG reply' });
//   }
// });


const { chromium } = require('playwright');

async function sendMessageToRAG({ username, password, agent, text }) {
  console.log('sendMessageToRAG called with:', { username: "***", agent, text: text?.substring(0, 30) });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // LOGIN FLOW
    console.log('Navigating to login page...');
    await page.goto('https://myblocks.in/login', { timeout: 60000 });
    await page.waitForLoadState('networkidle');

    console.log('Filling login credentials...');
    await page.fill('#username', username);
    await page.fill('#password', password);
    await page.selectOption('#userType', { value: 'BUSINESSAPP' });

    await page.click('#login-button');
    console.log('Login submitted...');

    await page.waitForSelector('a[href="/businessuserhome"]', { timeout: 30000 });
    await page.click('a[href="/businessuserhome"]');

    await page.waitForSelector('a[href="/rags"]', { timeout: 20000 });
    await page.click('a[href="/rags"]');

    // SELECT AGENT
    const agentSelector = `text=${agent}`;
    await page.waitForSelector(agentSelector, { timeout: 15000 });
    await page.click(agentSelector);

    // 1️⃣ RESET CHAT – avoid large token loads
    console.log("Resetting chat...");
    try {
      await page.waitForSelector('button:has-text("New Chat")', { timeout: 5000 });
      await page.click('button:has-text("New Chat")');
      console.log("Chat reset using New Chat button.");
    } catch (err) {
      console.log("New Chat button not found, trying trash icon...");
      try {
        await page.click('button:has(svg.lucide-trash)');
        console.log("Chat cleared using trash icon.");
      } catch {}
    }

    // Wait for clean page
    await page.waitForTimeout(1000);

    // CHAT INPUT
    const chatInput = await page.waitForSelector('textarea[placeholder="Ask a question..."]', { timeout: 10000 });

    // Count bot replies BEFORE sending message
    const botMsgSelector = 'div:has(svg.lucide-bot) > div.message-content';
    const prevCount = await page.locator(botMsgSelector).count();

    console.log("Typing user message...");
    await chatInput.fill(text);
    await chatInput.focus();
    await page.keyboard.press('Enter');

    console.log("Message sent. Waiting for bot reply...");

    // WAIT FOR **NEW BOT REPLY ONLY**
    let replyText = '';
    const timeout = 60000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const messages = await page.locator(botMsgSelector).all();
      const newCount = messages.length;

      if (newCount > prevCount) {
        const newMsg = messages[newCount - 1];

        // Clean HTML
        let html = await newMsg.evaluate(el => {
          const clone = el.cloneNode(true);
          clone.querySelectorAll('button').forEach(b => b.remove());
          clone.querySelectorAll('div[style*="font-size"], div[style*="gap"]').forEach(d => d.remove());
          return clone.innerHTML.trim();
        });

        // Remove HTML → plain text
        replyText = html.replace(/<[^>]+>/g, '').trim();

        if (replyText.length > 0) {
          console.log("Received bot reply:", replyText.substring(0, 200));
          break;
        }
      }

      await page.waitForTimeout(500);
    }

    if (!replyText) {
      console.log("No bot reply received within 60 seconds.");
      replyText = '';
    }

    return replyText;

  } catch (err) {
    console.error('RAG chat error:', err);
    throw err;

  } finally {
    await browser.close();
  }
}

module.exports = { sendMessageToRAG };


// API ENDPOINT
app.post('/rag-chat', async (req, res) => {
  const { username, password, agent, text } = req.body;

  if (!username || !password || !agent || !text) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    const reply = await sendMessageToRAG({ username, password, agent, text });
    res.json({ reply });

  } catch {
    res.status(500).json({ error: 'Failed to fetch RAG reply' });
  }
});


// POST /get-rag-agents
app.post('/get-rag-agents', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Missing username or password' });
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // 1️⃣ Go to login page
    console.log('Navigating to login page...');
    await page.goto('https://myblocks.in/login', { timeout: 60000 });
    await page.waitForLoadState('networkidle');
    console.log('Login page loaded');

    // 2️⃣ Fill login form
    console.log('Filling login credentials...');
    await page.fill('#username', username);
    await page.fill('#password', password);
    await page.selectOption('#userType', { value: 'BUSINESSAPP' });

    // 3️⃣ Click login
    await page.click('#login-button');
    console.log('Login submitted, waiting for main page...');

    // 4️⃣ Wait for Business App link and click it
    await page.waitForSelector('a[href="/businessuserhome"]', { timeout: 30000 });
    console.log('Main page loaded, clicking Business App link...');
    await page.click('a[href="/businessuserhome"]');

    // 5️⃣ Navigate to RAG page
    await page.waitForSelector('a[href="/rags"]', { timeout: 20000 });
    console.log('Business App loaded, navigating to RAG...');
    await page.click('a[href="/rags"]');

    // 6️⃣ Wait for agent elements
    await page.waitForSelector('div.list-group-item', { timeout: 15000 });
    console.log('Fetching agent names...');

    // 7️⃣ Extract agent names (ignore arrow spans)
    const agents = await page.$$eval('div.list-group-item', divs =>
      divs.map(d => d.childNodes[0].textContent.trim()).filter(t => t.length > 0)
    );

    console.log('Agents fetched:', agents);
    res.json({ agents });

  } catch (err) {
    console.error('Error fetching agents:', err);
    res.status(500).json({ error: 'Failed to fetch agents', details: err.message });
  } finally {
    await browser.close();
  }
});

// Start server
const port = process.env.PORT || 11020;
app.listen(port, () => {
  console.log(`🚀 Cloud-ready server running on port ${port}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${port}/health`);
}); 
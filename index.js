const express = require('express');
const app = express();
const port = 5000;
const multer = require('multer');
const { createWorker } = require('tesseract.js');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const knex = require('knex')(require('./knexfile'));

app.use(express.json());
const cors = require('cors');
app.use(cors());
app.use(express.static('.'));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = './uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ storage: storage });

// Enhanced date parsing
function parseDate(text) {
  const cleanText = text
    .replace(/daze|dace|dale/gi, 'date')
    .replace(/\.$/, ''); // Remove trailing period

  const datePatterns = [
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
    /(\w+)\s+(\d{1,2}),?\s+(\d{4})/,
    /(\d{1,2})\s+(\w+)\s+(\d{4})/,
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
  ];

  for (const pattern of datePatterns) {
    const match = cleanText.match(pattern);
    if (match) {
      try {
        let date;
        if (pattern === datePatterns[0]) {
          const [_, month, day, year] = match;
          const fullYear = year.length === 2 ? `20${year}` : year;
          date = new Date(`${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
        } else if (pattern === datePatterns[1]) {
          const [_, month, day, year] = match;
          date = new Date(`${month} ${day}, ${year}`);
        } else if (pattern === datePatterns[2]) {
          const [_, day, month, year] = match;
          date = new Date(`${month} ${day}, ${year}`);
        } else if (pattern === datePatterns[3]) {
          date = new Date(match[0]);
        }
        if (date && !isNaN(date.getTime())) {
          return date.toISOString().split('T')[0]; // YYYY-MM-DD format
        }
      } catch (e) {
        continue;
      }
    }
  }
  return new Date().toISOString().split('T')[0];
}

// Enhanced amount and currency extraction
function extractAmountAndCurrency(text) {
  const lines = text.split('\n').map(l => l.trim());
  let amount = '0.00';
  let currency = 'USD';

  const totalKeywords = [
    /total[:\s]*(?:(\w{3}))?\s*(\d+[,.]?\d*\.?\d{0,2})/i,
    /amount[:\s]*(?:(\w{3}))?\s*(\d+[,.]?\d*\.?\d{0,2})/i,
    /balance[:\s]*(?:(\w{3}))?\s*(\d+[,.]?\d*\.?\d{0,2})/i,
    /grand\s+total[:\s]*(?:(\w{3}))?\s*(\d+[,.]?\d*\.?\d{0,2})/i,
  ];

  for (const keyword of totalKeywords) {
    const match = text.match(keyword);
    if (match) {
      currency = match[1] ? match[1].toUpperCase() : currency; // Extract currency if present
      let amt = match[2].replace(/,/g, '');
      if (!amt.includes('.')) amt += '.00';
      amount = parseFloat(amt).toFixed(2);
      break;
    }
  }

  const currencyPattern = /(?:(\w{3}))\s*(\d+[,.]?\d*\.?\d{0,2})/gi;
  let match;
  while ((match = currencyPattern.exec(text)) !== null) {
    currency = match[1].toUpperCase();
    let amt = match[2].replace(/,/g, '');
    if (!amt.includes('.')) amt += '.00';
    amount = parseFloat(amt).toFixed(2);
  }

  return { amount, currency };
}

// Enhanced merchant extraction
function extractMerchant(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length > 0) {
    for (let line of lines) {
      line = line.replace(/[^\w\s\.\-&]/g, '').trim();
      if (line.length >= 3 && !/^\d+$/.test(line) && !/date|total|tax/i.test(line.toLowerCase())) {
        if (/enterprises/i.test(line)) return line;
        if (line !== 'PAYMENT RECEIPT') return line;
      }
    }
  }
  return 'Unknown Merchant';
}

// Enhanced description extraction
function extractDescription(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const descriptions = new Set();

  const itemPatterns = [
    /([a-zA-Z\s]{3,})\s+\d+\s+(?:USD|usd|\$)/i,
    /^([a-zA-Z\s]{5,})(?:\s+\d+|\s+USD|\s+\$)/i,
  ];

  for (const line of lines) {
    if (/^(date|daze|total|subtotal|tax|amount|time|invoice|receipt|payment)/i.test(line)) continue;
    if (/^[\d\s\$\.,]+$/.test(line)) continue;
    if (line.length < 5 || /\.com|@|http/i.test(line)) continue;

    for (const pattern of itemPatterns) {
      const match = line.match(pattern);
      if (match) {
        descriptions.add(match[1].trim());
        break;
      }
    }

    if (/transportation|disposal|service|product|item|barrel|waste/i.test(line) && 
        /[a-zA-Z]{3,}/.test(line) && 
        line.length > 10 && 
        !/^[A-Z\s]+$/.test(line)) {
      descriptions.add(line);
    }
  }

  return Array.from(descriptions).slice(0, 10).join('\n') || 'No description available';
}

app.post('/api/process-receipt', upload.single('receipt'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    const filePath = req.file.path;
    const processedPath = path.join('./uploads', `processed-${Date.now()}-${req.file.originalname}`);

    try {
      await sharp(filePath)
        .grayscale()
        .normalize()
        .sharpen()
        .linear(1.5, -(128 * 1.5) + 128)
        .toFile(processedPath);
    } catch (err) {
      await sharp(filePath)
        .grayscale()
        .normalize()
        .toFile(processedPath);
    }

    const worker = await createWorker('eng', 1, {
      logger: m => console.log(m)
    });
    
    await worker.setParameters({
      tessedit_pageseg_mode: '3',
      tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .,/$:-@',
    });

    const { data: { text } } = await worker.recognize(processedPath);
    await worker.terminate();
    
    console.log('========== RAW OCR TEXT ==========');
    console.log(text);
    console.log('==================================');

    const { amount, currency } = extractAmountAndCurrency(text);
    const parsedData = {
      amount: amount,
      date: parseDate(text),
      description: extractDescription(text),
      merchant: extractMerchant(text),
      currency: currency, // Added currency field
      receiptUrl: `/uploads/${req.file.filename}`,
    };

    console.log('========== PARSED DATA ==========');
    console.log(parsedData);
    console.log('=================================');

    fs.unlink(processedPath, (err) => {
      if (err) console.error('Error deleting processed file:', err);
    });

    res.json({ success: true, data: parsedData });
  } catch (error) {
    console.error('OCR Error:', error.message || error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to process receipt: ' + (error.message || 'Unknown error') 
    });
  }
});

app.post('/api/submit-receipt', async (req, res) => {
  try {
    const { amount, date, description, merchant, receiptUrl, currency } = req.body;
    if (!amount || !date || !merchant) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const expenseId = uuidv4();
    await knex('expenses').insert({
      id: expenseId,
      amount: parseFloat(amount),
      currency: currency || 'USD',
      date: date,
      description: description || 'No description',
      merchant: merchant,
      receipt_url: receiptUrl,
      status: 'draft',
      created_at: new Date().toISOString().replace('T', ' ').substr(0, 19),
    });

    res.json({ success: true, message: 'Receipt saved', expenseId });
  } catch (error) {
    console.error('Save Error:', error);
    res.status(500).json({ success: false, error: 'Failed to save receipt' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
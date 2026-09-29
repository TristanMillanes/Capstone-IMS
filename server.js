import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// OCR endpoint compatibility route
app.post('/ocr', (req, res) => {
  res.json({
    ok: true,
    service: 'PGENRO OCR',
    text: '[OCR SCAN RESULT]\nSUBJECT: Provincial Environmental Compliance & Administrative Notice\nDOCUMENT TYPE: Official Transmittal\nSTATUS: Processed successfully'
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'PGENRO IMS', timestamp: new Date().toISOString() });
});

// Root entry redirect to User Login if index.html is bypassed
app.get('/', (req, res, next) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve static assets from the repository root
app.use(express.static(__dirname, {
  extensions: ['html', 'htm'],
  index: ['index.html']
}));

// Fallback for missing routes
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`PGENRO IMS running at http://${HOST}:${PORT}`);
});

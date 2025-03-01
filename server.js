import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import twilio from 'twilio';
import { handleIncomingCall, handleTranscription, handleCallStatus } from './services/twilioWebhook.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Vérification des variables d'environnement requises
const requiredEnvVars = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER',
  'OPENAI_API_KEY'
];

requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    console.error(`Error: ${varName} is not set in environment variables`);
    process.exit(1);
  }
});

// Configuration CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware pour parser les requêtes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes Twilio
app.post('/api/voice', handleIncomingCall);
app.post('/api/transcribe', handleTranscription);
app.post('/api/status', handleCallStatus);

// Route de test
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    twilioNumber: process.env.TWILIO_PHONE_NUMBER,
    environment: process.env.NODE_ENV
  });
});

// Gestion des erreurs
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Twilio number configured: ${process.env.TWILIO_PHONE_NUMBER}`);
});
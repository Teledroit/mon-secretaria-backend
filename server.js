import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import twilio from 'twilio';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Initialize TwiML for voice responses
const { twiml } = twilio;

// Initialize Supabase client
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

// Configure nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// Vérification des variables d'environnement requises
const requiredEnvVars = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER',
  'OPENAI_API_KEY', // Utilisé par les Edge Functions Supabase, mais listé ici pour la complétude
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'EMAIL_USER',
  'EMAIL_PASSWORD',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'FRONTEND_URL',
  'BACKEND_URL',
  'TRANSFER_NUMBER'
];

requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    console.warn(`Warning: ${varName} is not set in environment variables. Some features might not work.`);
  }
});

// Configuration CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

// Middleware pour parser les requêtes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Middleware spécifique pour les webhooks Twilio qui envoient du x-www-form-urlencoded
app.use('/api/voice/webhook', express.raw({ type: 'application/x-www-form-urlencoded' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK_SEPT_16_19H', timestamp: new Date().toISOString() });
});

// Twilio Voice webhook endpoint
app.post('/api/voice/webhook', async (req, res) => {
  try {
    console.log('Incoming Twilio voice webhook:', req.body);
    
    const response = new twiml.VoiceResponse();
    
    // Get the caller's phone number
    const from = req.body.From;
    const to = req.body.To;
    const callSid = req.body.CallSid;
    
    console.log(`Incoming call from ${from} to ${to}, CallSid: ${callSid}`);
    
    // Log the call in the database
    try {
      const { data: callData, error: callError } = await supabase
        .from('calls')
        .insert({
          start_time: new Date().toISOString(),
          phone_number: from,
          status: 'in-progress',
          client_name: null // Will be updated later if identified
        })
        .select()
        .single();
        
      if (callError) {
        console.error('Error logging call:', callError);
      } else {
        console.log('Call logged with ID:', callData.id);
      }
    } catch (dbError) {
      console.error('Database error:', dbError);
    }
    
    // Create the AI assistant response
    response.say({
      voice: 'alice',
      language: 'fr-FR'
    }, "Bonjour, vous êtes en communication avec l'assistant virtuel du cabinet MonSecretarIA. Comment puis-je vous aider ?");
    
    // Gather user input
    const gather = response.gather({
      input: 'speech',
      language: 'fr-FR',
      speechTimeout: 'auto',
      action: '/api/voice/process-speech',
      method: 'POST'
    });
    
    gather.say({
      voice: 'alice',
      language: 'fr-FR'
    }, "Je vous écoute...");
    
    // Fallback if no input is detected
    response.say({
      voice: 'alice',
      language: 'fr-FR'
    }, "Je n'ai pas bien entendu. Au revoir.");
    
    response.hangup();
    
    res.type('text/xml');
    res.send(response.toString());
    
  } catch (error) {
    console.error('Error in voice webhook:', error);
    
    // Send a simple error response
    const errorResponse = new twiml.VoiceResponse();
    errorResponse.say({
      voice: 'alice',
      language: 'fr-FR'
    }, "Désolé, une erreur technique est survenue. Veuillez rappeler plus tard.");
    errorResponse.hangup();
    
    res.type('text/xml');
    res.send(errorResponse.toString());
  }
});

// Twilio Speech processing endpoint
app.post('/api/voice/process-speech', async (req, res) => {
  try {
    console.log('Processing speech input:', req.body);
    
    const speechResult = req.body.SpeechResult;
    const callSid = req.body.CallSid;
    const from = req.body.From;
    
    console.log(`Speech from ${from}: "${speechResult}"`);
    
    const response = new twiml.VoiceResponse();
    
    if (!speechResult) {
      response.say({
        voice: 'alice',
        language: 'fr-FR'
      }, "Je n'ai pas bien compris. Pouvez-vous répéter ?");
      
      // Gather again
      const gather = response.gather({
        input: 'speech',
        language: 'fr-FR',
        speechTimeout: 'auto',
        action: '/api/voice/process-speech',
        method: 'POST'
      });
      
      gather.say({
        voice: 'alice',
        language: 'fr-FR'
      }, "Je vous écoute...");
      
      response.hangup();
      res.type('text/xml');
      res.send(response.toString());
      return;
    }
    
    // Simple keyword detection for demo purposes
    const lowerSpeech = speechResult.toLowerCase();
    
    if (lowerSpeech.includes('rendez-vous') || lowerSpeech.includes('rdv') || lowerSpeech.includes('appointment')) {
      response.say({
        voice: 'alice',
        language: 'fr-FR'
      }, "Je peux vous aider à prendre un rendez-vous. Quel type de consultation souhaitez-vous ?");
      
      // Continue conversation
      const gather = response.gather({
        input: 'speech',
        language: 'fr-FR',
        speechTimeout: 'auto',
        action: '/api/voice/handle-appointment',
        method: 'POST'
      });
      
    } else if (lowerSpeech.includes('urgent') || lowerSpeech.includes('urgence')) {
      response.say({
        voice: 'alice',
        language: 'fr-FR'
      }, "Je comprends que c'est urgent. Je vais vous transférer immédiatement vers un avocat disponible.");
      
      // Transfer to configured number if available
      const transferNumber = process.env.TRANSFER_NUMBER;
      if (transferNumber) {
        response.dial(transferNumber);
      } else {
        response.say({
          voice: 'alice',
          language: 'fr-FR'
        }, "Malheureusement, aucun avocat n'est disponible pour le moment. Veuillez laisser vos coordonnées après le bip.");
        response.record({
          maxLength: 120,
          action: '/api/voice/handle-message'
        });
      }
      
    } else {
      response.say({
        voice: 'alice',
        language: 'fr-FR'
      }, "Je peux vous aider avec la prise de rendez-vous ou vous transférer vers un avocat. Que préférez-vous ?");
      
      const gather = response.gather({
        input: 'speech',
        language: 'fr-FR',
        speechTimeout: 'auto',
        action: '/api/voice/process-speech',
        method: 'POST'
      });
    }
    
    res.type('text/xml');
    res.send(response.toString());
    
  } catch (error) {
    console.error('Error processing speech:', error);
    
    const errorResponse = new twiml.VoiceResponse();
    errorResponse.say({
      voice: 'alice',
      language: 'fr-FR'
    }, "Une erreur est survenue. Au revoir.");
    errorResponse.hangup();
    
    res.type('text/xml');
    res.send(errorResponse.toString());
  }
});

// Handle appointment booking
app.post('/api/voice/handle-appointment', async (req, res) => {
  try {
    const speechResult = req.body.SpeechResult;
    const from = req.body.From;
    
    const response = new twiml.VoiceResponse();
    
    response.say({
      voice: 'alice',
      language: 'fr-FR'
    }, "Parfait. Pour prendre rendez-vous, je vais vous envoyer un SMS avec le lien de réservation. Merci de votre appel.");
    
    // Send SMS with Calendly link (if configured)
    try {
      const message = "Bonjour, voici le lien pour prendre rendez-vous avec notre cabinet : https://calendly.com/votre-cabinet. Merci !";
      
      await twilioClient.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: from
      });
      
      console.log(`SMS sent to ${from} with appointment link`);
    } catch (smsError) {
      console.error('Error sending SMS:', smsError);
    }
    
    response.hangup();
    res.type('text/xml');
    res.send(response.toString());
    
  } catch (error) {
    console.error('Error handling appointment:', error);
    
    const errorResponse = new twiml.VoiceResponse();
    errorResponse.say({
      voice: 'alice',
      language: 'fr-FR'
    }, "Une erreur est survenue. Au revoir.");
    errorResponse.hangup();
    
    res.type('text/xml');
    res.send(errorResponse.toString());
  }
});

// Handle voice messages/recordings
app.post('/api/voice/handle-message', async (req, res) => {
  try {
    const recordingUrl = req.body.RecordingUrl;
    const from = req.body.From;
    
    console.log(`Voice message received from ${from}: ${recordingUrl}`);
    
    // Here you could process the recording, transcribe it, etc.
    
    const response = new twiml.VoiceResponse();
    response.say({
      voice: 'alice',
      language: 'fr-FR'
    }, "Votre message a été enregistré. Un avocat vous rappellera dans les plus brefs délais. Au revoir.");
    response.hangup();
    
    res.type('text/xml');
    res.send(response.toString());
    
  } catch (error) {
    console.error('Error handling voice message:', error);
    
    const errorResponse = new twiml.VoiceResponse();
    errorResponse.hangup();
    
    res.type('text/xml');
    res.send(errorResponse.toString());
  }
});

// Contact form endpoint
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: 'contact.monsecretaria@gmail.com',
      subject: `Nouveau message de contact - ${name}`,
      html: `
        <h2>Nouveau message de contact</h2>
        <p><strong>Nom:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Téléphone:</strong> ${phone}</p>
        <p><strong>Message:</strong></p>
        <p>${message}</p>
      `
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: 'Email sent successfully' });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// SMS sending endpoint
app.post('/api/send-sms', async (req, res) => {
  try {
    const { to, message, userId } = req.body;

    if (!to || !message) {
      return res.status(400).json({ 
        error: 'Missing required fields: to, message' 
      });
    }

    // Validate phone number format (basic validation)
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    if (!phoneRegex.test(to)) {
      return res.status(400).json({ 
        error: 'Invalid phone number format. Use international format (+33123456789)' 
      });
    }

    // Send SMS via Twilio
    const smsResult = await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: to
    });

    // Log SMS in database if userId is provided
    if (userId) {
      await supabase
        .from('sms_logs')
        .insert({
          user_id: userId,
          phone_number: to,
          message: message,
          twilio_sid: smsResult.sid,
          status: smsResult.status,
          notification_type: 'manual_sms', // Added a type for manual SMS
          sent_at: new Date().toISOString()
        });
    }

    res.json({ 
      success: true, 
      messageSid: smsResult.sid,
      status: smsResult.status 
    });

  } catch (error) {
    console.error('Error sending SMS:', error);
    res.status(500).json({ 
      error: 'Failed to send SMS',
      details: error.message 
    });
  }
});

// Notification trigger endpoint
app.post('/api/trigger-notification', async (req, res) => {
  try {
    const { userId, type, data } = req.body;

    if (!userId || !type) {
      return res.status(400).json({ 
        error: 'Missing required fields: userId, type' 
      });
    }

    // Get user and their notification preferences
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('phone, email')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { data: config, error: configError } = await supabase
      .from('configurations')
      .select('notifications')
      .eq('user_id', userId)
      .single();

    if (configError) {
      return res.status(404).json({ error: 'User configuration not found' });
    }

    const notifications = config.notifications || {};
    let message = '';
    let shouldSendSMS = false;
    let shouldSendEmail = false;
    let emailAddress = user.email; // Default to user's account email

    // Determine notification content and preferences based on type
    switch (type) {
      case 'appointment_booked':
        if (notifications.appointments?.enabled) {
          message = `Nouveau rendez-vous confirmé: ${data.clientName} le ${data.date} à ${data.time}`;
          shouldSendSMS = notifications.appointments.sms && user.phone;
          shouldSendEmail = notifications.appointments.email && user.email;
          if (notifications.appointments.emailAddress) {
            emailAddress = notifications.appointments.emailAddress;
          }
        }
        break;

      case 'urgent_call':
        if (notifications.urgentCalls?.enabled) {
          message = `URGENT: Appel nécessitant votre attention immédiate de ${data.clientName || 'un client'} (${data.phoneNumber})`;
          shouldSendSMS = notifications.urgentCalls.sms && user.phone;
          shouldSendEmail = notifications.urgentCalls.email && user.email;
          if (notifications.urgentCalls.emailAddress) {
            emailAddress = notifications.urgentCalls.emailAddress;
          }
        }
        break;

      case 'important_request':
        if (notifications.importantRequests?.enabled) {
          const threshold = notifications.importantRequests.threshold || 'high';
          // Assuming data.importance is a string like 'low', 'medium', 'high'
          const importanceLevels = { 'low': 0, 'medium': 1, 'high': 2 };
          if (importanceLevels[data.importance] >= importanceLevels[threshold]) {
            message = `Demande importante: ${data.subject} de ${data.clientName || 'un client'}`;
            shouldSendSMS = false; // Important requests only via email
            shouldSendEmail = notifications.importantRequests.email && user.email;
            if (notifications.importantRequests.emailAddress) {
              emailAddress = notifications.importantRequests.emailAddress;
            }
          }
        }
        break;

      default:
        return res.status(400).json({ error: 'Invalid notification type' });
    }

    const results = {
      sms: null,
      email: null
    };

    // Send SMS if enabled and phone number available
    if (shouldSendSMS && user.phone) {
      try {
        const smsResult = await twilioClient.messages.create({
          body: message,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: user.phone
        });

        results.sms = {
          success: true,
          messageSid: smsResult.sid,
          status: smsResult.status
        };

        // Log SMS
        await supabase
          .from('sms_logs')
          .insert({
            user_id: userId,
            phone_number: user.phone,
            message: message,
            twilio_sid: smsResult.sid,
            status: smsResult.status,
            notification_type: type,
            sent_at: new Date().toISOString()
          });

      } catch (smsError) {
        console.error('SMS sending failed:', smsError);
        results.sms = {
          success: false,
          error: smsError.message
        };
      }
    }

    // Send email if enabled and email available
    if (shouldSendEmail && emailAddress) { // Use emailAddress which might be custom
      try {
        const emailSubject = type === 'urgent_call' 
          ? '🚨 URGENT - MonSecretarIA' 
          : '📞 Notification - MonSecretarIA';

        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: emailAddress, // Use the potentially custom email address
          subject: emailSubject,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1f2937;">MonSecretarIA - Notification</h2>
              <p style="font-size: 16px; line-height: 1.5;">${message}</p>
              ${data.details ? `<p style="color: #6b7280;">${data.details}</p>` : ''}
              <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">
              <p style="font-size: 12px; color: #9ca3af;">
                Cette notification a été envoyée automatiquement par votre assistant MonSecretarIA.
              </p>
            </div>
          `
        };

        await transporter.sendMail(mailOptions);
        results.email = { success: true };

      } catch (emailError) {
        console.error('Email sending failed:', emailError);
        results.email = {
          success: false,
          error: emailError.message
        };
      }
    }

    res.json({
      success: true,
      type,
      message,
      results,
      sentSMS: shouldSendSMS,
      sentEmail: shouldSendEmail
    });

  } catch (error) {
    console.error('Error triggering notification:', error);
    res.status(500).json({ 
      error: 'Failed to trigger notification',
      details: error.message 
    });
  }
});

// Phone number search endpoint (for buying numbers)
app.post('/api/phone-numbers/search', async (req, res) => {
  try {
    const { areaCode } = req.body;

    const availableNumbers = await twilioClient.availablePhoneNumbers('FR')
      .local
      .list({
        areaCode: areaCode,
        limit: 10
      });

    const formattedNumbers = availableNumbers.map(number => ({
      number: number.phoneNumber,
      location: number.locality || 'France',
      type: 'local',
      price: 1 // €1/month for French numbers
    }));

    res.json({ numbers: formattedNumbers });

  } catch (error) {
    console.error('Error searching phone numbers:', error);
    res.status(500).json({ error: 'Failed to search phone numbers' });
  }
});

// Phone number purchase endpoint
app.post('/api/phone-numbers/purchase', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization header required' });
    }

    // Get user from auth token
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid authentication' });
    }

    // Purchase number via Twilio
    const purchasedNumber = await twilioClient.incomingPhoneNumbers.create({
      phoneNumber: phoneNumber,
      voiceUrl: `${process.env.BACKEND_URL || process.env.VITE_BACKEND_URL}/api/voice/webhook`,
      voiceMethod: 'POST'
    });

    // Save to database
    await supabase
      .from('twilio_phone_numbers')
      .insert({
        account_id: user.id, // This should reference twilio_accounts table
        phone_number: phoneNumber,
        friendly_name: purchasedNumber.friendlyName,
        status: 'active'
      });

    res.json({ 
      success: true, 
      phoneNumber: purchasedNumber.phoneNumber,
      sid: purchasedNumber.sid 
    });

  } catch (error) {
    console.error('Error purchasing phone number:', error);
    res.status(500).json({ error: 'Failed to purchase phone number' });
  }
});

// Google OAuth token exchange endpoint
app.post('/api/google-oauth-exchange', async (req, res) => {
  console.log('DEBUG: Request received at /api/google-oauth-exchange');
  try {
    console.log('Google OAuth exchange request received:', {
      hasCode: !!req.body.code,
      redirectUri: req.body.redirect_uri,
      timestamp: new Date().toISOString()
    });
    
    const { code, redirect_uri } = req.body;

    if (!code || !redirect_uri) {
      console.error('Missing required fields:', { code: !!code, redirect_uri: !!redirect_uri });
      return res.status(400).json({ 
        error: 'Missing required fields: code, redirect_uri' 
      });
    }

    const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    const FRONTEND_URL = process.env.FRONTEND_URL;

    if (!CLIENT_ID || !CLIENT_SECRET) {
      console.error('Google OAuth credentials missing:', { 
        hasClientId: !!CLIENT_ID, 
        hasClientSecret: !!CLIENT_SECRET,
        frontendUrl: FRONTEND_URL
      });
      return res.status(500).json({ 
        error: 'Google OAuth credentials not configured on server' 
      });
    }
    
    // Validate redirect_uri matches expected frontend URL
    const expectedRedirectUri = `${FRONTEND_URL}/calendar/callback`;
    if (redirect_uri !== expectedRedirectUri) {
      console.error('Redirect URI mismatch:', {
        received: redirect_uri,
        expected: expectedRedirectUri
      });
    }

    console.log('Exchanging code for tokens with Google...', {
      clientId: CLIENT_ID.substring(0, 10) + '...',
      redirectUri: redirect_uri
    });
    
    // Exchange authorization code for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: redirect_uri,
        grant_type: 'authorization_code'
      })
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}));
      console.error('Google token exchange error:', {
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        errorData
      });
      return res.status(tokenResponse.status).json({
        error: errorData.error_description || errorData.error || 'Token exchange failed'
      });
    }

    const tokens = await tokenResponse.json();
    console.log('Tokens received successfully from Google');
    
    // Return tokens to frontend
    res.json(tokens);

  } catch (error) {
    console.error('Error in Google OAuth exchange:', error);
    res.status(500).json({ 
      error: 'Internal server error during OAuth exchange',
      details: error.message 
    });
  }
});

// Gestion des erreurs
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Twilio number configured: ${process.env.TWILIO_PHONE_NUMBER}`);
  console.log(`Health check: http://localhost:${port}/health`);
  console.log(`Voice webhook URL: ${process.env.BACKEND_URL || process.env.VITE_BACKEND_URL}/api/voice/webhook`);
});

git add backend/server.js
git commit -m "Add detailed logging for Google OAuth debugging"
git push origin main


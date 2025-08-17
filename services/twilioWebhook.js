import twilio from 'twilio';
import OpenAI from 'openai';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  OPENAI_API_KEY
} = process.env;

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const ttsClient = new TextToSpeechClient();
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

export async function handleIncomingCall(req, res) {
  const twiml = new twilio.twiml.VoiceResponse();

  // Configuration initiale de l'appel
  twiml.say({
    language: 'fr-FR',
    voice: 'woman'
  }, "Bonjour, vous êtes en communication avec l'assistant virtuel du cabinet. Comment puis-je vous aider ?");

  // Démarrer l'enregistrement pour la transcription
  twiml.record({
    action: '/api/transcribe',
    transcribe: true,
    transcribeCallback: '/api/handle-transcription',
    maxLength: 300,
    playBeep: false
  });

  res.type('text/xml');
  res.send(twiml.toString());
}

export async function handleTranscription(req, res) {
  const transcription = req.body.TranscriptionText;
  const callSid = req.body.CallSid;

  try {
    // Obtenir la réponse de l'IA
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "Vous êtes un assistant virtuel professionnel pour un cabinet d'avocats. Répondez de manière concise et professionnelle."
        },
        {
          role: "user",
          content: transcription
        }
      ]
    });

    const aiResponse = completion.choices[0].message.content;

    // Convertir la réponse en audio
    const [ttsResponse] = await ttsClient.synthesizeSpeech({
      input: { text: aiResponse },
      voice: { languageCode: 'fr-FR', ssmlGender: 'FEMALE' },
      audioConfig: { audioEncoding: 'MP3' },
    });

    // Jouer la réponse dans l'appel
    await client.calls(callSid)
      .update({
        twiml: new twilio.twiml.VoiceResponse()
          .play({ contentType: 'audio/mp3' }, Buffer.from(ttsResponse.audioContent).toString('base64'))
          .toString()
      });

    res.sendStatus(200);
  } catch (error) {
    console.error('Error handling transcription:', error);
    res.sendStatus(500);
  }
}

export async function handleCallStatus(req, res) {
  console.log('Call status update:', req.body);
  res.sendStatus(200);
}
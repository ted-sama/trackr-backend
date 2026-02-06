import { GoogleGenAI } from '@google/genai'
import env from '#start/env'

export async function aiTranslate(text: string, to: string): Promise<string> {
  const apiKey = env.get('GEMINI_API_KEY')
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured')
  }

  const genai = new GoogleGenAI({
    apiKey,
  })

  const translation = await genai.models.generateContent({
    model: 'gemini-2.5-flash-lite',
    contents: [
      {
        role: 'user',
        parts: [{ text: `Translate the following book description to ${to}: ${text}` }],
      },
    ],
    config: {
      systemInstruction: [
        'You are an expert in manga and comic books translations.',
        'You are given a book description and a language to translate to.',
        "Respect the original book description and don't add any information that is not in the original description.",
        'You need to translate the book description to the given language.',
        'You need to make the translation accurate and informative.',
        "Go straight to the translation, don't start with 'Here is the translation for the book ...'",
        'Translation must be in the given language.',
      ],
      maxOutputTokens: 2048,
      temperature: 0.7,
    },
  })

  return translation.text || ''
}

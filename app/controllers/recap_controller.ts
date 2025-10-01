import type { HttpContext } from '@adonisjs/core/http'
import Book from '#models/book'
import { GoogleGenAI } from '@google/genai'

export default class RecapController {
  /**
   * @summary Generate manga chapter recap
   * @tag Books
   * @description Generates a recap of previous chapters using AI with web search
   * @paramPath id - Book ID - @type(number) @required
   * @paramPath chapterId - Chapter number up to which to generate recap - @type(number) @required
   * @responseBody 200 - Streaming text response with chapter recap
   * @responseBody 404 - Book not found
   * @responseBody 500 - Internal server error
   */
  async recap({ params, response }: HttpContext) {
    try {
      const { id: bookId, chapterId } = params

      // Verify book exists
      const book = await Book.find(bookId)
      if (!book) {
        return response.notFound({ message: 'Book not found' })
      }

      // Convert chapterId to number for validation
      const chapterNumber = parseInt(chapterId)
      if (isNaN(chapterNumber) || chapterNumber <= 0) {
        return response.badRequest({ message: 'Chapter number must be a positive integer' })
      }

      // Initialize Gemini AI
      const apiKey = process.env.GEMINI_API_KEY
      if (!apiKey) {
        return response.internalServerError({ message: 'AI service not configured' })
      }

      const ai = new GoogleGenAI({ apiKey })

      // Create prompt for recap generation
      const prompt = `Generate a comprehensive recap for the manga "${book.title}" by ${book.author} for chapter ${chapterNumber}.`

      // Set response headers for streaming
      response.header('Content-Type', 'text/plain; charset=utf-8')
      response.header('Transfer-Encoding', 'chunked')
      response.header('X-Accel-Buffering', 'no') // Disable nginx buffering

      // Generate streaming response
      const streamResponse = await ai.models.generateContentStream({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          systemInstruction: [
            'You are an expert in manga and comic books recaps.',
            'You are given a book and a chapter number.',
            'You need to generate a recap of the previous chapters up to the given chapter number.',
            'You need to make the recap engaging and informative for someone who wants to catch up or refresh their memory before reading the next chapter.',
            'Provide main plot developments, character development and relationships, key events and conflicts, important reveals or twists, current situation/cliffhangers. But you NEED to keep it SHORT',
            'You need to use the web search tool to find accurate information about the manga.',
            'Recap must be effective and informative, not too long or too short. (max 200 words)',
            "Go straight to the recap, don't start with 'Here is the recap for the manga ...'",
            'Recap must be in french language.',
          ],
          maxOutputTokens: 2048,
          temperature: 0.7,
          tools: [
            {
              googleSearch: {},
            },
          ],
        },
      })

      // Stream the response back to client
      for await (const chunk of streamResponse) {
        if (chunk.text) {
          response.response.write(chunk.text)
        }
      }

      response.response.end()
    } catch (error) {
      console.error('Recap generation error:', error)
      if (!response.response.headersSent) {
        return response.internalServerError({
          message: 'Failed to generate recap',
          error: error.message,
        })
      } else {
        response.response.write('\n\n[Error: Failed to complete recap generation]')
        response.response.end()
      }
    }
  }
}

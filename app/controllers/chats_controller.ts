import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'
import { convertToModelMessages, streamText, UIMessage } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'

const openrouter = createOpenRouter({
  apiKey: env.get('OPENROUTER_API_KEY'),
})

export default class ChatsController {
  public async stream({ request, response }: HttpContext) {
    const { messages } = request.body() as { messages: UIMessage[] }

    const result = streamText({
      model: openrouter('perplexity/sonar-reasoning-pro:online'),
      messages: convertToModelMessages(messages),
    })

    // Masquer le raisonnement de Perplexity
    return result.pipeUIMessageStreamToResponse(response.response, {
      sendReasoning: false,
    })
  }

  // Ajouter un endpoint pour gérer les OPTIONS (CORS preflight)
  public async options({ response }: HttpContext) {
    response.header('Access-Control-Allow-Origin', '*')
    response.header('Access-Control-Allow-Methods', 'POST, OPTIONS')
    response.header('Access-Control-Allow-Headers', 'Content-Type, ngrok-skip-browser-warning')
    return response.noContent()
  }
}

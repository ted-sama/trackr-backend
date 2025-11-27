import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'
import {
  convertToModelMessages,
  streamText,
  type UIMessage,
  type ModelMessage,
  type TextPart,
} from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import Book from '#models/book'

const openrouter = createOpenRouter({
  apiKey: env.get('OPENROUTER_API_KEY'),
})

function sanitizeForOpenRouter(messages: ModelMessage[]): ModelMessage[] {
  return (
    messages
      // Many text-only models don't accept tool role messages in history.
      .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
      .map<ModelMessage>((m) => {
        if (typeof m.content === 'string') {
          return m
        }

        // Keep only text parts, drop reasoning/tool/image/file parts
        const text = m.content
          .filter(
            (p): p is TextPart =>
              (p as TextPart).type === 'text' && typeof (p as TextPart).text === 'string'
          )
          .map((p) => (p as TextPart).text)
          .join('')

        return { role: m.role, content: text }
      })
      // Drop empty messages that might result from filtering
      .filter((m) => (typeof m.content === 'string' ? m.content.trim() !== '' : true))
  )
}

function enrichMessageWithBookContext(
  messages: ModelMessage[],
  bookTitle: string,
  currentChapter: number | null,
  authors?: string
): ModelMessage[] {
  if (messages.length === 0) return messages

  // Trouver le dernier message utilisateur
  let lastUserMessageIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserMessageIndex = i
      break
    }
  }

  // Si aucun message utilisateur trouvé, retourner les messages tels quels
  if (lastUserMessageIndex === -1) return messages

  // Enrichir TOUJOURS avec le contexte du livre
  let contextSuffix = `[Livre: ${bookTitle}`
  if (authors) {
    contextSuffix += `, Auteur(s): ${authors}`
  }
  if (currentChapter !== null) {
    contextSuffix += `, Chapitre: ${currentChapter}`
  }
  contextSuffix += ']'

  // Retourner une copie modifiée des messages
  return messages.map((message, index) => {
    if (index === lastUserMessageIndex) {
      // Si c'est une string, ajouter le contexte
      if (typeof message.content === 'string') {
        return {
          ...message,
          content: `${message.content.trim()} ${contextSuffix}`,
        } as ModelMessage
      }

      // Si c'est un tableau, ajouter le contexte au dernier élément text
      if (Array.isArray(message.content)) {
        const enrichedContent = message.content.map((part, i) => {
          // Si c'est le dernier élément de type text, enrichir
          if (part.type === 'text' && typeof part.text === 'string') {
            const remainingParts = message.content.slice(i + 1)
            const isLastText = Array.isArray(remainingParts)
              ? remainingParts.every((p: unknown) => {
                  return !(typeof p === 'object' && p && 'type' in p && p.type === 'text')
                })
              : true

            if (isLastText) {
              return {
                ...part,
                text: `${(part as TextPart).text.trim()} ${contextSuffix}`,
              }
            }
          }
          return part
        })
        return {
          ...message,
          content: enrichedContent,
        } as ModelMessage
      }

      return message
    }
    return message
  })
}

export default class ChatsController {
  public async stream({ request, response, auth }: HttpContext) {
    const bookId = request.param('bookId') as number
    const book = await Book.find(bookId)
    if (!book) {
      return response.notFound({ message: 'Book not found' })
    }
    const user = await auth.authenticate()
    if (!user) {
      return response.unauthorized({ message: 'Unauthorized' })
    }
    const bookTracking = await book
      .related('bookTrackings')
      .query()
      .where('user_id', user.id)
      .first()
    if (!bookTracking) {
      return response.notFound({ message: 'Book tracking not found' })
    }

    // Charger les auteurs et publishers du livre
    await book.load('authors')
    await book.load('publishers')
    const authorNames = book.authors.map((author) => author.name).join(', ')

    const { messages } = request.body() as { messages: UIMessage[] }

    // Convertir les messages en ModelMessage
    const modelMessages = convertToModelMessages(messages, { ignoreIncompleteToolCalls: true })

    // Enrichir le dernier message utilisateur avec le contexte du livre
    const enrichedMessages = enrichMessageWithBookContext(
      modelMessages,
      book.title,
      bookTracking.currentChapter,
      authorNames
    )

    console.log(enrichedMessages[0].content)

    // Construire le prompt système avec les informations du livre et du suivi
    const systemPrompt = `Tu es un assistant spécialisé dans les mangas, comics et manhwa. Ta mission est de répondre avec précision, clarté et nuance, et de discuter de manière fiable de l'œuvre de l'utilisateur (intrigue, personnages, thèmes, arcs, publication, continuités, adaptations, recommandations, ordres de lecture). Tu privilégies les informations vérifiables et sourcées. Adapte toujours ta réponse au niveau de spoilers souhaité par l'utilisateur.

IMPORTANT: Information sur le livre actuel de l'utilisateur:
- Titre: ${book.title}
${authorNames ? `- Auteur(s): ${authorNames}` : ''}
- Type: ${book.type || 'Non spécifié'}
- Statut: ${book.status}
- Chapitres disponibles: ${book.chapters || 'Non spécifié'}
- Volumes: ${book.volumes || 'Non spécifié'}
- Année de sortie: ${book.releaseYear || 'Non spécifiée'}
- Description: ${book.description || 'Non disponible'}
${book.genres ? `- Genres: ${Array.isArray(book.genres) ? book.genres.join(', ') : book.genres}` : ''}
${book.alternativeTitles ? `- Titres alternatifs: ${Array.isArray(book.alternativeTitles) ? book.alternativeTitles.join(', ') : book.alternativeTitles}` : ''}

CHAPITRE / ISSUE ACTUEL DE L'UTILISATEUR (dernier lu):
- Chapitre / Issue: ${bookTracking.currentChapter !== null ? bookTracking.currentChapter : 'Non spécifié'}
- Volume: ${bookTracking.currentVolume !== null ? bookTracking.currentVolume : 'Non spécifié'}
- Statut de lecture: ${bookTracking.status}

CRITÈRE ABSOLU CONTRE LES SPOILERS:
Tu DOIS impérativement éviter de spoiler au-delà du chapitre ${bookTracking.currentChapter !== null ? bookTracking.currentChapter : 'le dernier lu'}. Ne mentionne AUCUN événement, révélation, ou développement de personnage qui se produit après ce chapitre. Tu connais l'avancement de l'utilisateur et tu dois adapter tes réponses en conséquence.

Principes clés
- Si l'utilisateur ne mentionne pas le livre actuel dans sa question, pars toujours du principe qu'il parle du livre actuel, ne va pas chercher des informations sur d'autres livres.
- Langue: réponds TOUJOURS dans la même langue que celle utilisée par l'utilisateur dans son dernier message. Détecte automatiquement la langue (français, anglais, espagnol, etc.) et utilise cette langue pour ta réponse.
- Fiabilité d'abord: vérifie les faits susceptibles d'évoluer (dates de sortie, chapitres/volumes, rééditions, annonces d'adaptations, ventes, classements, statut 'en cours/terminé', équipes créatives, numérotation des issues) via Web Search, et cite tes sources.
- Concision: privilégie des réponses courtes et directes. Utilise des puces uniquement si nécessaire. Évite les résumés introductifs - va droit au but.
- Respect des spoilers: par défaut, évite les révélations cruciales au delà du dernier chapitre lu par l'utilisateur.
- Légalité et éthique: oriente vers des plateformes officielles/légales. N'aide pas au piratage. Fournis des avertissements de contenu (violence, gore, thèmes adultes). N'emploie pas de contenu sexuel impliquant des mineurs.
- Transparence: si une info est incertaine/controversée, indique-le et présente les différentes positions avec sources.

Recherche et citations (Web Search)
- Déclencheurs de recherche: toute information datée, sujette à changement, ou point où tu n'es pas ≥ 90 % certain. Exemples: "One Piece chapitre 1100 date FR", "DC Rebirth reading order 2016-2020", "Solo Leveling anime S2 annonce 2025-xx-xx", "Ventes Demon Slayer Oricon 2020-2021", "Marvel Earth-616 vs Earth-1610".
- Procédure: 
  1) Formule 1–2 requêtes concises avec noms et dates (évite "récemment", préfère des dates absolues).
  2) Intègre les faits et ajoute des citations en fin de réponse.
- Format des citations: références numérotées [1], [2]…

Canon, continuités et adaptations
- Manga/anime: distingue canon manga vs fillers/anime original; précise arcs (chapitres/volumes/épisodes). Mentionne les différences d'édition (volumes JP vs FR/EN). Focus sur le manga, pas d'anime
- Manhwa/webtoon/novel: distingue webnovel, webtoon, print; précise plateformes (Naver Webtoon, KakaoPage, Tapas) et statut (hiatus, saison, reprise).
- Comics: précise l'univers/continuité (Marvel Earth-616 / Ultimate 1610 / MCU; DC Pre/Post-Crisis, New 52, Rebirth, Infinite Frontier, Elseworlds). Donne l'ordre de lecture par arcs avec numéros d'issues et années. Mentionne les équipes créatives majeures.
- Si plusieurs œuvres homonymes existent, demande une clarification avant d'exposer une réponse détaillée.

Titres, noms et terminologie
- Donne le titre original + localisé (FR/EN) si utile, avec romanisation correcte (Hepburn pour JP). Fournis alias connus des personnages et groupes.
- Normalise les noms (ex: Roronoa Zoro/Zoro Roronoa), et mentionne variantes de traduction si cela évite des confusions.

Recommandations et ordres de lecture
- Si l'utilisateur veut des recos, pose 2–3 questions rapides (genres/thèmes, tonalité, niveau de violence, longueur, terminé vs en cours).
- Propose 3–7 titres pertinents. Pour chacun: courte accroche, pourquoi ça matche, longueur/statut, âge conseillé, avertissements de contenu, où lire/regarder légalement.
- Pour les ordres de lecture, donne la version "essentielle" puis "complète (optionnelle)", avec arcs, numéros/chapitres, années, et portes d'entrée recommandées.

Style de réponse (par défaut)
- Réponses CONCISES et directes : limite-toi aux informations essentielles. Évite les développements longs sauf si l'utilisateur demande explicitement plus de détails (ex: "explique en détail", "développe", "parle-moi plus de...", "donne plus d'informations").
- Structure minimale : donne directement la réponse à la question, sans introductions longues ni conclusions verbeuses.
- Si la question est simple, réponds de manière simple. Si elle nécessite plus d'explications, fournis-les mais de manière concise.
- LANGUE DE RÉPONSE : Tu DOIS impérativement répondre dans EXACTEMENT la même langue que celle utilisée par l'utilisateur. Si l'utilisateur écrit en français, réponds en français. Si l'utilisateur écrit en anglais, réponds en anglais. Si l'utilisateur écrit en espagnol, réponds en espagnol, etc. Détecte automatiquement la langue du dernier message utilisateur et utilise cette langue pour ta réponse.

Gestion des incertitudes et controverses
- Si les sources divergent, indique la divergence et choisis la source la plus autoritaire (éditeur officiel > wiki communautaire). Explique brièvement le choix.
- Si tu ne trouves pas de source fiable, dis-le et propose d'élargir/raffiner la recherche.

Sécurité et limites
- Pas d'aide au piratage ni liens douteux.
- Pas de descriptions sexuelles explicites, surtout impliquant des mineurs.
- Mentionne les avertissements de contenu quand c'est pertinent (gore, traumatismes, etc.).

Exemples de tâches que tu gères bien
- "Explique-moi l'arc Chimera Ant (sans spoiler majeur)."
- "Ordre de lecture Batman post-Crisis jusqu'à Rebirth."
- "Différences manga vs anime pour Fullmetal Alchemist."
- "Recommandations de manhwa dark fantasy, terminé, < 150 chapitres."
- "Où lire légalement Chainsaw Man en français ?"
- "Qui est canon dans Spider-Verse (comics) vs films ?"

IMPORTANT - Interprétation des questions dans le contexte du livre actuel:
Par défaut, l'utilisateur parle TOUJOURS du livre qu'il est en train de lire (livre actuel). Exemples:
- "Résume le dernier chapitre" → Résume le dernier chapitre du livre actuel (${book.title}), pas "Le Dernier Chapitre" comme livre.
- "Qui est ce personnage ?" → Qui est ce personnage dans ${book.title}.
- "Que va-t-il se passer ensuite ?" → Prédiction basée sur ${book.title} sans spoiler au-delà du chapitre ${bookTracking.currentChapter}.
- "Explique cet arc" → Explique l'arc en cours dans ${book.title}.
- "Combien de chapitres reste-t-il ?" → Nombre de chapitres restants dans ${book.title}.
- "Cet auteur est bon ?" → Parle de l'auteur de ${book.title}, pas d'un autre auteur.
- "Que penser de cette œuvre ?" → Analyse de ${book.title}, contexte et avis.

NE FAIS PAS de recherche sur d'autres livres sauf si l'utilisateur mentionne explicitement un autre titre/nom d'œuvre. Le contexte du livre actuel est toujours implicite.`

    const result = streamText({
      model: openrouter('x-ai/grok-4-fast:online'),
      messages: sanitizeForOpenRouter(enrichedMessages),
      system: systemPrompt,
    })

    // Masquer le raisonnement de Perplexity
    return result.pipeUIMessageStreamToResponse(response.response, {
      sendReasoning: false,
      sendSources: true,
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

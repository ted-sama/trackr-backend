import ModeratedContent from '#models/moderated_content'
import type { ModerationResourceType, ModerationReason } from '#models/moderated_content'

interface FilterResult {
  isClean: boolean
  detectedIssues: string[]
  reason?: ModerationReason
  censoredContent?: string
}

export default class ContentFilterService {
  private static profanityPatterns = [
    // French profanity patterns
    /\b(merde|putain|connard|salope|enculé?|bite|chatte|con|pute|pd|fdp|ntm|ta gueule)\b/gi,
    /\b(nique|niquer|enc(ule|uler))\b/gi,

    // English profanity patterns
    /\b(fuck|shit|bitch|ass|damn|cunt|cock|dick|pussy|whore|slut)\b/gi,
    /\b(fck|fuk|sh\*t|b\*tch)\b/gi,

    // Hate speech patterns
    /\b(negro|n[i1]gg[ae]r|k[i1]ke|f[a4]gg[o0]t|r[e3]t[a4]rd)\b/gi,

    // Numbers substitutions
    /\b(n[i1!]g+[e3@]+r+|f[a4@]g+[o0]t+)\b/gi,
  ]

  private static hateSpeechPatterns = [
    /\b(nazi|hitler|race (superiority|supremacy))\b/gi,
    /\b(kill (yourself|urself|all))\b/gi,
    /\b(terrorist|terrorism)\b/gi,
  ]

  private static spamPatterns = [
    /\b(viagra|cialis|casino|lottery|winner)\b/gi,
    /\b(click here|buy now|limited offer)\b/gi,
    /(http|https|www\.)[^\s]{10,}/gi, // Long URLs
    /(.)\1{10,}/g, // Repeated characters (aaaaaaaaaa)
  ]

  static checkContent(content: string, resourceType: ModerationResourceType): FilterResult {
    const detectedIssues: string[] = []
    let reason: ModerationReason | undefined
    let censoredContent: string = content

    if (this.containsProfanity(content)) {
      detectedIssues.push('profanity')
      reason = 'profanity'
      censoredContent = this.censorProfanity(content)
    }

    if (this.containsHateSpeech(content)) {
      detectedIssues.push('hate_speech')
      reason = 'hate_speech'
      censoredContent = this.censorHateSpeech(content)
    }

    if (this.containsSpam(content)) {
      detectedIssues.push('spam')
      reason = reason || 'spam'
      censoredContent = this.censorSpam(content)
    }

    if (resourceType === 'username' && this.containsInvalidUsername(content)) {
      detectedIssues.push('invalid_username_format')
    }

    return {
      isClean: detectedIssues.length === 0,
      detectedIssues,
      reason,
      censoredContent: detectedIssues.length > 0 ? censoredContent : undefined,
    }
  }

  private static containsProfanity(content: string): boolean {
    return this.profanityPatterns.some((pattern) => pattern.test(content))
  }

  private static containsHateSpeech(content: string): boolean {
    return this.hateSpeechPatterns.some((pattern) => pattern.test(content))
  }

  private static containsSpam(content: string): boolean {
    return this.spamPatterns.some((pattern) => pattern.test(content))
  }

  private static containsInvalidUsername(username: string): boolean {
    // Check for admin-like names, system names, or misleading names
    const reservedPatterns = [
      /\b(admin|administrator|moderator|support|system|official|staff)\b/gi,
      /\b(trackr|trckr)\b/gi,
    ]

    return reservedPatterns.some((pattern) => pattern.test(username))
  }

  private static censorProfanity(content: string): string {
    let censored = content
    this.profanityPatterns.forEach((pattern) => {
      censored = censored.replace(pattern, (match) => this.censorWord(match))
    })
    return censored
  }

  private static censorHateSpeech(content: string): string {
    let censored = content
    this.hateSpeechPatterns.forEach((pattern) => {
      censored = censored.replace(pattern, (match) => this.censorWord(match))
    })
    return censored
  }

  private static censorSpam(content: string): string {
    let censored = content
    this.spamPatterns.forEach((pattern) => {
      censored = censored.replace(pattern, (match) => {
        if (match.includes('http') || match.includes('www')) {
          return '[URL removed]'
        }
        return this.censorWord(match)
      })
    })
    return censored
  }

  private static censorWord(word: string): string {
    if (word.length <= 2) return '**'
    return word[0] + '*'.repeat(word.length - 2) + word[word.length - 1]
  }

  static async logModeration(
    userId: string,
    resourceType: ModerationResourceType,
    originalContent: string,
    censoredContent: string,
    reason: ModerationReason,
    resourceId: string | null = null,
    moderatedBy: string | null = null
  ): Promise<ModeratedContent> {
    return await ModeratedContent.create({
      userId,
      resourceType,
      resourceId,
      originalContent,
      censoredContent,
      action: 'auto_censored',
      reason,
      moderatedBy,
      isActive: true,
    })
  }

  static validateAndCensor(
    content: string,
    resourceType: ModerationResourceType,
    options: {
      autoReject?: boolean
      autoCensor?: boolean
    } = {}
  ): { isValid: boolean; content: string; reason?: ModerationReason } {
    const { autoReject = false, autoCensor = true } = options
    const result = this.checkContent(content, resourceType)

    if (!result.isClean) {
      if (autoReject) {
        return {
          isValid: false,
          content,
          reason: result.reason,
        }
      }

      if (autoCensor && result.censoredContent) {
        return {
          isValid: true,
          content: result.censoredContent,
          reason: result.reason,
        }
      }
    }

    return {
      isValid: true,
      content,
    }
  }
}

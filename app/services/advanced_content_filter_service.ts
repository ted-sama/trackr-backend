import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
  type MatchPayload,
} from 'obscenity'
import ModeratedContent from '#models/moderated_content'
import type { ModerationResourceType, ModerationReason } from '#models/moderated_content'

/**
 * Severity levels for content violations
 */
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface FilterResult {
  isClean: boolean
  detectedIssues: string[]
  reason?: ModerationReason
  censoredContent?: string
  severity: Severity
  matches: string[]
}

/**
 * French profanity dictionary with variations
 * Includes common French swear words and slurs
 */
const FRENCH_PROFANITY: string[] = [
  // Common profanity
  'merde',
  'putain',
  'connard',
  'connasse',
  'salope',
  'salaud',
  'encule',
  'enculer',
  'bite',
  'chatte',
  'couilles',
  'bordel',
  'foutre',
  'nique',
  'niquer',
  'baiser',
  'pute',
  'petasse',
  'pouffiasse',
  'cul',
  'fion',
  'branleur',
  'branlette',
  'chiasse',
  'chiotte',
  'merdeux',
  'merdique',
  'trou du cul',
  'va te faire',
  'ta gueule',
  // Slurs and insults
  'pd',
  'pede',
  'pedal',
  'pedale',
  'tantouze',
  'tapette',
  'tarlouze',
  'gouine',
  'negre',
  'bougnoule',
  'bicot',
  'raton',
  'youpin',
  'youtre',
  'feuj',
  'niakwe',
  'niakoue',
  'bamboula',
  'melon',
  'chintok',
  'bridé',
  // Abbreviations
  'fdp',
  'ntm',
  'tg',
  'ptdr',
]

/**
 * Hate speech patterns (both languages)
 */
const HATE_SPEECH_PATTERNS: RegExp[] = [
  // Violence incitement
  /\b(kill\s+(yourself|urself|all|them)|suicide\s+is|go\s+die)\b/gi,
  /\b(tue(-?toi)?|va\s+(te\s+)?crever|mort\s+aux?)\b/gi,
  // Hate symbols/ideologies
  /\b(nazi|hitler|white\s*power|heil|reich|aryan)\b/gi,
  /\b(supremacy|supremacist|ethnic\s*cleansing)\b/gi,
  // Slurs detection
  /\b(n[i1!][gq]+[e3@]+r|f[a4@][gq]+[o0]+t|r[e3]t[a4]rd)\b/gi,
]

/**
 * Spam patterns
 */
const SPAM_PATTERNS: RegExp[] = [
  // Commercial spam
  /\b(viagra|cialis|casino|lottery|winner|jackpot)\b/gi,
  /\b(click\s+here|buy\s+now|limited\s+(offer|time)|free\s+money)\b/gi,
  /\b(make\s+money|earn\s+\$|get\s+rich|work\s+from\s+home)\b/gi,
  // Long URLs (potential phishing)
  /(https?:\/\/|www\.)[^\s]{50,}/gi,
  // Repeated characters (aaaaaaa, !!!!!!!)
  /(.)\1{7,}/g,
  // Excessive caps (more than 70% caps in a string of 10+ chars)
  /\b[A-Z\s]{10,}\b/g,
]

/**
 * Leetspeak normalization map
 */
const LEETSPEAK_MAP: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '2': 'z',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '6': 'g',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'i',
  '+': 't',
  '€': 'e',
  '£': 'e',
  '¢': 'c',
}

/**
 * Reserved/misleading username patterns
 */
const RESERVED_USERNAME_PATTERNS: RegExp[] = [
  /\b(admin|administrator|moderator|mod|support|system|official|staff)\b/gi,
  /\b(trackr|trckr|trakr)\b/gi,
  /\b(help|service|customer|tech)\b/gi,
]

export default class AdvancedContentFilterService {
  private static matcher: RegExpMatcher
  private static initialized = false

  /**
   * Initialize the obscenity matcher with English dataset
   */
  private static initialize() {
    if (this.initialized) return

    this.matcher = new RegExpMatcher({
      ...englishDataset.build(),
      ...englishRecommendedTransformers,
    })

    this.initialized = true
  }

  /**
   * Normalize text for better detection
   * - Unicode normalization (NFKD)
   * - Leetspeak conversion
   * - Remove spacing tricks
   */
  static normalizeText(text: string): string {
    // Unicode normalization (accents to base letters)
    let normalized = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')

    // Leetspeak conversion
    for (const [leet, letter] of Object.entries(LEETSPEAK_MAP)) {
      normalized = normalized.split(leet).join(letter)
    }

    // Remove spacing tricks (f.u.c.k -> fuck, f u c k -> fuck)
    // Only for short segments to avoid false positives
    normalized = normalized.replace(/\b([a-z])[\s.]+([a-z])[\s.]+([a-z])[\s.]+([a-z])\b/gi, '$1$2$3$4')
    normalized = normalized.replace(/\b([a-z])[\s.]+([a-z])[\s.]+([a-z])\b/gi, '$1$2$3')

    return normalized.toLowerCase()
  }

  /**
   * Check content for profanity and other violations
   */
  static checkContent(content: string, resourceType: ModerationResourceType): FilterResult {
    this.initialize()

    const detectedIssues: string[] = []
    const matches: string[] = []
    let reason: ModerationReason | undefined
    let severity: Severity = 'LOW'

    const normalizedContent = this.normalizeText(content)
    const originalLower = content.toLowerCase()

    // Check with obscenity library (English)
    const obscenityMatches = this.matcher.getAllMatches(normalizedContent)
    if (obscenityMatches.length > 0) {
      detectedIssues.push('profanity')
      reason = 'profanity'
      severity = 'MEDIUM'
      matches.push(...this.extractMatchedWords(normalizedContent, obscenityMatches))
    }

    // Check French profanity
    for (const word of FRENCH_PROFANITY) {
      const wordRegex = new RegExp(`\\b${this.escapeRegex(word)}\\b`, 'gi')
      if (wordRegex.test(normalizedContent) || wordRegex.test(originalLower)) {
        if (!detectedIssues.includes('profanity')) {
          detectedIssues.push('profanity')
          reason = 'profanity'
          severity = 'MEDIUM'
        }
        matches.push(word)
      }
    }

    // Check hate speech (highest severity)
    for (const pattern of HATE_SPEECH_PATTERNS) {
      const hateSpeechMatches = normalizedContent.match(pattern) || originalLower.match(pattern)
      if (hateSpeechMatches) {
        if (!detectedIssues.includes('hate_speech')) {
          detectedIssues.push('hate_speech')
        }
        reason = 'hate_speech'
        severity = 'CRITICAL'
        matches.push(...hateSpeechMatches)
      }
    }

    // Check spam
    for (const pattern of SPAM_PATTERNS) {
      const spamMatches = content.match(pattern)
      if (spamMatches) {
        if (!detectedIssues.includes('spam')) {
          detectedIssues.push('spam')
        }
        if (!reason) {
          reason = 'spam'
          severity = 'LOW'
        }
        matches.push(...spamMatches)
      }
    }

    // Check reserved usernames
    if (resourceType === 'username') {
      for (const pattern of RESERVED_USERNAME_PATTERNS) {
        if (pattern.test(content)) {
          detectedIssues.push('invalid_username_format')
          matches.push(content)
        }
      }
    }

    // Build censored content if issues found
    let censoredContent: string | undefined
    if (detectedIssues.length > 0) {
      censoredContent = this.censorContent(content, matches)
    }

    return {
      isClean: detectedIssues.length === 0,
      detectedIssues,
      reason,
      censoredContent,
      severity,
      matches: [...new Set(matches)], // Deduplicate
    }
  }

  /**
   * Extract matched words from obscenity results
   */
  private static extractMatchedWords(text: string, payloads: MatchPayload[]): string[] {
    return payloads.map((payload) => text.slice(payload.startIndex, payload.endIndex + 1))
  }

  /**
   * Escape regex special characters
   */
  private static escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  /**
   * Censor detected bad words
   */
  private static censorContent(content: string, badWords: string[]): string {
    let censored = content

    for (const word of badWords) {
      // Fully mask the word with asterisks
      const censoredWord = '*'.repeat(word.length)
      censored = censored.replace(new RegExp(this.escapeRegex(word), 'gi'), censoredWord)
    }

    return censored
  }

  /**
   * Validate and optionally censor content
   */
  static validateAndCensor(
    content: string,
    resourceType: ModerationResourceType,
    options: {
      autoReject?: boolean
      autoCensor?: boolean
    } = {}
  ): { isValid: boolean; content: string; reason?: ModerationReason; severity: Severity } {
    const { autoReject = false, autoCensor = true } = options
    const result = this.checkContent(content, resourceType)

    if (!result.isClean) {
      if (autoReject) {
        return {
          isValid: false,
          content,
          reason: result.reason,
          severity: result.severity,
        }
      }

      if (autoCensor && result.censoredContent) {
        return {
          isValid: true,
          content: result.censoredContent,
          reason: result.reason,
          severity: result.severity,
        }
      }
    }

    return {
      isValid: true,
      content,
      severity: 'LOW',
    }
  }

  /**
   * Log moderation action to database
   */
  static async logModeration(
    userId: string,
    resourceType: ModerationResourceType,
    originalContent: string,
    censoredContent: string | null,
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

  /**
   * Get severity weight for strike calculations
   */
  static getSeverityWeight(severity: Severity): number {
    switch (severity) {
      case 'LOW':
        return 1
      case 'MEDIUM':
        return 2
      case 'HIGH':
        return 3
      case 'CRITICAL':
        return 4
      default:
        return 1
    }
  }

  /**
   * Map filter severity to strike severity
   */
  static mapToStrikeSeverity(severity: Severity): 'minor' | 'moderate' | 'severe' {
    switch (severity) {
      case 'LOW':
        return 'minor'
      case 'MEDIUM':
        return 'moderate'
      case 'HIGH':
      case 'CRITICAL':
        return 'severe'
      default:
        return 'minor'
    }
  }
}

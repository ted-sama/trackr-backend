/**
 * Moderation Configuration
 *
 * This file contains all configuration related to the moderation system,
 * including strike thresholds, ban durations, and severity mappings.
 */

const moderationConfig = {
  /**
   * Strike system configuration
   */
  strikes: {
    /**
     * Number of strikes before user receives a warning
     */
    warningThreshold: 1,

    /**
     * Number of strikes before user receives a temporary ban
     */
    tempBanThreshold: 3,

    /**
     * Number of strikes before user receives a permanent ban
     */
    permaBanThreshold: 5,

    /**
     * Temporary ban durations in days (escalating)
     * Index corresponds to: 1st temp ban, 2nd temp ban, etc.
     */
    tempBanDurations: [1, 3, 7, 14, 30] as const,

    /**
     * Number of days after which strikes expire
     * Set to null for never-expiring strikes
     */
    strikeExpirationDays: 90,
  },

  /**
   * Severity configuration for different violation types
   */
  severityConfig: {
    profanity: 'minor',
    spam: 'moderate',
    harassment: 'severe',
    hate_speech: 'severe',
    other: 'minor',
  } as const,

  /**
   * Severity levels with their numeric weights
   */
  severityLevels: {
    minor: {
      weight: 1,
      description: 'Minor violation - single strike',
    },
    moderate: {
      weight: 2,
      description: 'Moderate violation - double strike impact',
    },
    severe: {
      weight: 3,
      description: 'Severe violation - triple strike impact, may warrant immediate action',
    },
  } as const,

  /**
   * Report priority configuration
   */
  priority: {
    /**
     * Auto-escalate priority based on user's strike count
     */
    autoEscalateThresholds: {
      high: 2, // User has 2+ strikes
      critical: 4, // User has 4+ strikes
    },

    /**
     * Reason-based priority defaults
     */
    reasonDefaults: {
      offensive_content: 'medium',
      spam: 'low',
      harassment: 'high',
      other: 'low',
    } as const,
  },

  /**
   * Content filter settings
   */
  contentFilter: {
    /**
     * Maximum number of auto-censors before triggering a strike
     */
    autoCensorStrikeThreshold: 3,

    /**
     * Time window (in hours) for counting auto-censors
     */
    autoCensorTimeWindow: 24,
  },

  /**
   * Notification settings
   */
  notifications: {
    /**
     * Whether to notify admins of high/critical priority reports
     */
    notifyAdminsOnHighPriority: true,

    /**
     * Whether to notify users when their content is moderated
     */
    notifyUserOnModeration: true,

    /**
     * Whether to notify reporters when their report is resolved
     */
    notifyReporterOnResolution: true,
  },
}

export default moderationConfig

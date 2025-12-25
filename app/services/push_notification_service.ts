import User from '#models/user'

interface ExpoPushMessage {
  to: string
  sound?: 'default' | null
  title?: string
  body: string
  data?: Record<string, any>
  badge?: number
}

interface ExpoPushTicket {
  status: 'ok' | 'error'
  id?: string
  message?: string
  details?: {
    error?: string
  }
}

export default class PushNotificationService {
  private static readonly EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

  /**
   * Send a push notification to a user
   */
  static async sendToUser(
    userId: string,
    notification: { title?: string; body: string; data?: Record<string, any> }
  ): Promise<boolean> {
    const user = await User.find(userId)

    if (!user?.pushToken) {
      return false
    }

    return this.send({
      to: user.pushToken,
      sound: 'default',
      title: notification.title,
      body: notification.body,
      data: notification.data,
    })
  }

  /**
   * Send a push notification
   */
  static async send(message: ExpoPushMessage): Promise<boolean> {
    // Validate Expo push token format
    if (!this.isValidExpoPushToken(message.to)) {
      console.warn(`Invalid Expo push token: ${message.to}`)
      return false
    }

    try {
      const response = await fetch(this.EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      })

      if (!response.ok) {
        console.error(`Expo Push API error: ${response.status} ${response.statusText}`)
        return false
      }

      const result = (await response.json()) as { data: ExpoPushTicket }

      if (result.data.status === 'error') {
        console.error(`Push notification error: ${result.data.message}`, result.data.details)

        // If token is invalid, we could clear it from the user
        if (result.data.details?.error === 'DeviceNotRegistered') {
          await this.clearInvalidToken(message.to)
        }

        return false
      }

      return true
    } catch (error) {
      console.error('Failed to send push notification:', error)
      return false
    }
  }

  /**
   * Send push notifications to multiple users
   */
  static async sendToUsers(
    userIds: string[],
    notification: { title?: string; body: string; data?: Record<string, any> }
  ): Promise<void> {
    const users = await User.query().whereIn('id', userIds).whereNotNull('push_token')

    const messages: ExpoPushMessage[] = users
      .filter((user) => user.pushToken && this.isValidExpoPushToken(user.pushToken))
      .map((user) => ({
        to: user.pushToken!,
        sound: 'default' as const,
        title: notification.title,
        body: notification.body,
        data: notification.data,
      }))

    if (messages.length === 0) {
      return
    }

    // Expo recommends batching up to 100 messages at a time
    const chunks = this.chunkArray(messages, 100)

    for (const chunk of chunks) {
      try {
        await fetch(this.EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(chunk),
        })
      } catch (error) {
        console.error('Failed to send batch push notifications:', error)
      }
    }
  }

  /**
   * Validate Expo push token format
   */
  private static isValidExpoPushToken(token: string): boolean {
    return /^ExponentPushToken\[.+\]$/.test(token) || /^[a-zA-Z0-9-_]+$/.test(token)
  }

  /**
   * Clear invalid token from user
   */
  private static async clearInvalidToken(token: string): Promise<void> {
    await User.query().where('push_token', token).update({ pushToken: null })
  }

  /**
   * Split array into chunks
   */
  private static chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size))
    }
    return chunks
  }
}

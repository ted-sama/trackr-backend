import ActivityLog from '#models/activity_log'
import Book from '#models/book'
import List from '#models/list'

export class ActivityLogEnricher {
  /**
   * Enrichit une liste d'activity logs avec les détails des ressources associées
   */
  static async enrich(logs: ActivityLog[]) {
    // Grouper les IDs par type de ressource
    const bookIds: number[] = []
    const listIds: number[] = []

    for (const log of logs) {
      if (log.resourceType === 'book' && log.resourceId) {
        bookIds.push(Number.parseInt(log.resourceId))
      } else if (log.resourceType === 'list' && log.resourceId) {
        listIds.push(Number.parseInt(log.resourceId))
      }
    }

    // Charger toutes les ressources en une seule requête par type
    const [books, lists] = await Promise.all([
      bookIds.length > 0 ? Book.query().whereIn('id', bookIds).select('id', 'title') : [],
      listIds.length > 0 ? List.query().whereIn('id', listIds).select('id', 'name') : [],
    ])

    // Créer des maps pour un accès rapide
    const booksMap = new Map(books.map((b) => [b.id, b]))
    const listsMap = new Map(lists.map((l) => [l.id, l]))

    // Enrichir chaque log
    return logs.map((log) => {
      const logData = log.toJSON()
      let resource = null

      if (log.resourceType === 'book' && log.resourceId) {
        const book = booksMap.get(Number.parseInt(log.resourceId))
        resource = book
          ? {
              type: 'book',
              item: {
                id: book.id,
                title: book.title,
              },
            }
          : null
      } else if (log.resourceType === 'list' && log.resourceId) {
        const list = listsMap.get(Number.parseInt(log.resourceId))
        resource = list
          ? {
              type: 'list',
              item: {
                id: list.id,
                name: list.name,
              },
            }
          : null
      }

      // Retourner le log enrichi sans resourceType et resourceId
      const { resourceType, resourceId, ...rest } = logData
      return {
        ...rest,
        resource,
      }
    })
  }
}

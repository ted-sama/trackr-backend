import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export async function getRecommendations(userId: string, count: number = 10) {
  try {
    const command = `cd /home/ted/dev/trackr/recommandation-algorithm && . venv/bin/activate && python main.py --mode predict --user_id "${userId}" --n_recommendations ${count} --real-data --json`
    const { stdout } = await execAsync(command)

    console.log('Recommendations fetched:', stdout)
    return JSON.parse(stdout)
  } catch (error) {
    console.error('Error fetching recommendations:', error)
    return []
  }
}

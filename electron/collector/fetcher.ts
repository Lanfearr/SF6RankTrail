import type { Match } from '../../shared/types'

export interface MatchSource {
  fetchMatches(shortId: string, page?: number): Promise<Match[]>
  fetchAllMatches?(shortId: string): Promise<Match[]>
}

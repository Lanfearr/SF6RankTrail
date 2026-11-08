import type { CurrentRating, Match } from '../../shared/types'

export interface MatchSource {
  fetchMatches(shortId: string, page?: number): Promise<Match[]>
  fetchAllMatches?(shortId: string): Promise<Match[]>
  fetchCurrentRatings?(shortId: string): Promise<CurrentRating[]>
  getPlayerName?(shortId: string): string | null
}

export type Gender = 'men' | 'women';

export const CATEGORY_CODES = ['OW', 'DF', 'GW', 'GL', 'A', 'B', 'C', 'D', 'E', 'F'] as const;
export type CategoryCode = (typeof CATEGORY_CODES)[number];

export type RankingType = 'european' | 'world' | 'road';

/** One peer's score + country, for country-quota-aware pool ranking. */
export interface CountryScore {
  score: number;
  country: string;
}

export interface ScoringTable {
  event: 'high_jump';
  unit: 'm';
  source: string;
  /** gender -> mark string (e.g. "2.30") -> points */
  points_by_mark: Record<Gender, Record<string, number>>;
}

export interface PlacingPoints {
  source: string;
  /** category -> position string (e.g. "1") -> points */
  final: Record<CategoryCode, Record<string, number>>;
}

export interface Category {
  code: CategoryCode;
  name: string;
}

export type NotifyPrefs = {
  place: boolean;
  score: boolean;
  result: boolean;
  qualification: boolean;
};

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  place: true,
  score: true,
  result: true,
  qualification: true,
};

export interface NotificationSettings {
  email_enabled: boolean;
  unsubscribe_token: string;
}

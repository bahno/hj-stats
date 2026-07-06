import scoringTableJson from '../data/scoring_table.json';
import placingPointsJson from '../data/placing_points.json';
import categoriesJson from '../data/categories.json';
import type { ScoringTable, PlacingPoints, Category } from '../data/types';

export const scoringTable = scoringTableJson as ScoringTable;
export const placingPoints = placingPointsJson as PlacingPoints;
export const categories = categoriesJson as Category[];

// @ts-nocheck
// Stub: Place search out of scope. Returns empty list.
export type PlaceResult = {
  description: string;
  place_id?: string;
  main_text?: string;
  secondary_text?: string;
};

export type PlaceSuggestion = PlaceResult;

export async function searchPlaces(_input: { query: string; types?: string }): Promise<PlaceResult[]> {
  return [];
}

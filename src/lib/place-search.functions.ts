// Stub: Google Places search is out of scope in this migration.
// Returns empty results so location-combobox renders an empty list.
import { createServerFn } from "@tanstack/react-start";

export type PlaceSuggestion = {
  description: string;
  place_id?: string;
};

export const searchPlaces = createServerFn({ method: "POST" })
  .inputValidator((input: { query: string; types?: string }) => input)
  .handler(async (): Promise<PlaceSuggestion[]> => {
    return [];
  });

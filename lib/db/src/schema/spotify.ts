import { pgTable, text, timestamp, bigint } from "drizzle-orm/pg-core";

/**
 * Stores Spotify OAuth tokens for the single user of this Infinity instance.
 */
export const spotifyTokens = pgTable("spotify_tokens", {
  id:           text("id").primaryKey().default("default"),
  accessToken:  text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt:    bigint("expires_at", { mode: "number" }).notNull(), // unix ms
  displayName:  text("display_name"),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
});

export type SpotifyTokens = typeof spotifyTokens.$inferSelect;

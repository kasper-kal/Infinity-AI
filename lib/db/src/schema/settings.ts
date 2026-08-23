import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const infinitySettings = pgTable("infinity-ai_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

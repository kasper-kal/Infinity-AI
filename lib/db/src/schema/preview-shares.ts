import { pgTable, uuid, text, timestamp, boolean, jsonb, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const previewShares = pgTable(
  "preview_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    componentId: uuid("component_id").references(() => buildApps.id, { onDelete: "set null" }),
    previewUrl: text("preview_url").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    shareToken: text("share_token").notNull().unique(),
    accessLevel: text("access_level", { enum: ["public", "private", "password"] }).notNull().default("public"),
    passwordHash: text("password_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    allowedEmails: jsonb("allowed_emails").$type<string[]>().default([]),
    allowedDomains: jsonb("allowed_domains").$type<string[]>().default([]),
    enableComments: boolean("enable_comments").notNull().default(true),
    enableReactions: boolean("enable_reactions").notNull().default(true),
    notifyOnComment: boolean("notify_on_comment").notNull().default(true),
    viewCount: integer("view_count").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),
    createdBy: uuid("created_by").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectIdx: index("preview_shares_project_idx").on(table.projectId),
    tokenIdx: uniqueIndex("preview_shares_token_idx").on(table.shareToken),
    expiresIdx: index("preview_shares_expires_idx").on(table.expiresAt),
  })
);

export const previewShareAccess = pgTable(
  "preview_share_access",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shareId: uuid("share_id").notNull().references(() => previewShares.id, { onDelete: "cascade" }),
    email: text("email"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    accessedAt: timestamp("accessed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    shareIdx: index("preview_share_access_share_idx").on(table.shareId),
    accessedIdx: index("preview_share_access_accessed_idx").on(table.accessedAt),
  })
);

export const previewComments = pgTable(
  "preview_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shareId: uuid("share_id").notNull().references(() => previewShares.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references(() => previewComments.id, { onDelete: "cascade" }),
    elementSelector: text("element_selector"),
    elementData: jsonb("element_data").$type<{
      tagName: string;
      className?: string;
      props?: Record<string, any>;
      rect?: { x: number; y: number; width: number; height: number };
    }>(),
    authorName: text("author_name").notNull(),
    authorEmail: text("author_email"),
    authorAvatar: text("author_avatar"),
    content: text("content").notNull(),
    isResolved: boolean("is_resolved").notNull().default(false),
    resolvedBy: uuid("resolved_by").references(() => accounts.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    reactions: jsonb("reactions").$type<Record<string, string[]>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    shareIdx: index("preview_comments_share_idx").on(table.shareId),
    parentIdx: index("preview_comments_parent_idx").on(table.parentId),
    elementIdx: index("preview_comments_element_idx").on(table.elementSelector),
    createdIdx: index("preview_comments_created_idx").on(table.createdAt),
  })
);

export const previewCommentMentions = pgTable(
  "preview_comment_mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commentId: uuid("comment_id").notNull().references(() => previewComments.id, { onDelete: "cascade" }),
    mentionedEmail: text("mentioned_email").notNull(),
    notified: boolean("notified").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    commentIdx: index("preview_comment_mentions_comment_idx").on(table.commentId),
    emailIdx: index("preview_comment_mentions_email_idx").on(table.mentionedEmail),
  })
);

// Relations
export const previewSharesRelations = relations(previewShares, ({ many, one }) => ({
  comments: many(previewComments),
  accessLog: many(previewShareAccess),
  project: one(projects, { fields: [previewShares.projectId], references: [projects.id] }),
  component: one(buildApps, { fields: [previewShares.componentId], references: [buildApps.id] }),
  creator: one(accounts, { fields: [previewShares.createdBy], references: [accounts.id] }),
}));

export const previewShareAccessRelations = relations(previewShareAccess, ({ one }) => ({
  share: one(previewShares, { fields: [previewShareAccess.shareId], references: [previewShares.id] }),
}));

export const previewCommentsRelations = relations(previewComments, ({ one, many }) => ({
  share: one(previewShares, { fields: [previewComments.shareId], references: [previewShares.id] }),
  parent: one(previewComments, { fields: [previewComments.parentId], references: [previewComments.id] }),
  replies: many(previewComments, { relationName: "replies" }),
  mentions: many(previewCommentMentions),
  resolver: one(accounts, { fields: [previewComments.resolvedBy], references: [accounts.id] }),
}));

export const previewCommentMentionsRelations = relations(previewCommentMentions, ({ one }) => ({
  comment: one(previewComments, { fields: [previewCommentMentions.commentId], references: [previewComments.id] }),
}));

// Import related tables for relations
import { projects } from "./projects";
import { buildApps } from "./build-apps";
import { accounts } from "./accounts";
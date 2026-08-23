import { Router, type Response } from "express";
import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { and, asc, eq, gt, isNull, or } from "drizzle-orm";
import {
  accounts,
  conversations,
  db,
  groupChats,
  groupMembers,
  inviteCodes,
  messages,
  sessions,
} from "@workspace/db";

const router = Router();
const SESSION_COOKIE = "infinity_session";
const OWNER_COOKIE = "infinity_owner_token";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const INVITE_TTL_MS = 1000 * 60 * 60 * 24;

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function readCookie(header: string | undefined, name: string): string | null {
  const prefix = `${name}=`;
  const value = header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : null;
}

function setCookie(res: Response, name: string, value: string, maxAge: number): void {
  res.setHeader("Set-Cookie", `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${Math.floor(maxAge / 1000)}; SameSite=Lax; HttpOnly`);
}

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return expectedBuffer.length === actual.length && timingSafeEqual(actual, expectedBuffer);
}

async function currentAccount(req: { headers: { cookie?: string } }) {
  const token = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (!token) return null;
  const [row] = await db
    .select({ account: accounts })
    .from(sessions)
    .innerJoin(accounts, eq(sessions.accountId, accounts.id))
    .where(and(
      eq(sessions.token, token),
      or(isNull(sessions.expiresAt), gt(sessions.expiresAt, new Date())),
    ));
  return row?.account ?? null;
}

async function createSession(res: Response, accountId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    token,
    accountId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  setCookie(res, SESSION_COOKIE, token, SESSION_TTL_MS);
}

async function canAccessGroup(req: { headers: { cookie?: string } }, group: typeof groupChats.$inferSelect): Promise<boolean> {
  const ownerToken = readCookie(req.headers.cookie, OWNER_COOKIE);
  if (ownerToken && group.ownerTokenHash && hashSecret(ownerToken) === group.ownerTokenHash) return true;
  const account = await currentAccount(req);
  if (!account) return false;
  const [member] = await db.select({ id: groupMembers.id }).from(groupMembers).where(and(
    eq(groupMembers.groupId, group.id),
    eq(groupMembers.accountId, account.id),
  ));
  return Boolean(member);
}

async function uniqueInviteCode(groupId: string): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = String(randomInt(1000, 10000));
    const [existing] = await db.select({ id: inviteCodes.id }).from(inviteCodes).where(eq(inviteCodes.code, code));
    if (!existing) return code;
  }
  throw new Error(`Could not allocate an invite code for group ${groupId}`);
}

function publicAccount(account: typeof accounts.$inferSelect) {
  return { id: account.id, email: account.email, displayName: account.displayName, avatarUrl: account.avatarUrl };
}

router.post("/accounts/signup", async (req, res) => {
  const email = cleanText(req.body?.email, 240).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const displayName = cleanText(req.body?.displayName, 80);
  if (!email || !email.includes("@") || password.length < 8 || !displayName) {
    res.status(400).json({ error: "Email, display name, and a password of at least 8 characters are required" });
    return;
  }
  try {
    const [existing] = await db.select().from(accounts).where(eq(accounts.email, email));
    if (existing) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }
    const [account] = await db.insert(accounts).values({ email, passwordHash: hashPassword(password), displayName }).returning();
    await createSession(res, account.id);
    res.status(201).json({ account: publicAccount(account) });
  } catch (err) {
    req.log.error({ err }, "Failed to create account");
    res.status(500).json({ error: "Failed to create account" });
  }
});

router.post("/accounts/login", async (req, res) => {
  const email = cleanText(req.body?.email, 240).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }
  try {
    const [account] = await db.select().from(accounts).where(eq(accounts.email, email));
    if (!account || !verifyPassword(password, account.passwordHash)) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    await createSession(res, account.id);
    res.json({ account: publicAccount(account) });
  } catch (err) {
    req.log.error({ err }, "Failed to log in");
    res.status(500).json({ error: "Failed to log in" });
  }
});

router.post("/accounts/logout", async (req, res) => {
  const token = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (token) await db.delete(sessions).where(eq(sessions.token, token)).catch(() => {});
  setCookie(res, SESSION_COOKIE, "", 0);
  res.json({ ok: true });
});

router.get("/accounts/me", async (req, res) => {
  try {
    const account = await currentAccount(req);
    res.json({ account: account ? publicAccount(account) : null });
  } catch {
    res.json({ account: null });
  }
});

router.get("/groups", async (req, res) => {
  try {
    const account = await currentAccount(req);
    if (account) {
      const rows = await db
        .select({ group: groupChats })
        .from(groupMembers)
        .innerJoin(groupChats, eq(groupMembers.groupId, groupChats.id))
        .where(eq(groupMembers.accountId, account.id))
        .orderBy(groupChats.updatedAt);
      res.json(rows.map(({ group }) => group));
      return;
    }
    const ownerToken = readCookie(req.headers.cookie, OWNER_COOKIE);
    if (!ownerToken) {
      res.json([]);
      return;
    }
    const rows = await db.select().from(groupChats).orderBy(groupChats.updatedAt);
    res.json(rows.filter((group) => group.ownerTokenHash && hashSecret(ownerToken) === group.ownerTokenHash));
  } catch (err) {
    req.log.error({ err }, "Failed to list groups");
    res.status(500).json({ error: "Failed to list groups" });
  }
});

router.get("/groups/by-conversation/:conversationId", async (req, res) => {
  try {
    const [row] = await db.select().from(groupChats).where(eq(groupChats.id, req.params.conversationId));
    if (!row) {
      res.status(404).json({ error: "This conversation is not a group" });
      return;
    }
    if (!(await canAccessGroup(req, row))) {
      res.status(404).json({ error: "This conversation is not a group" });
      return;
    }
    const members = await db.select().from(groupMembers).where(eq(groupMembers.groupId, row.id)).orderBy(asc(groupMembers.joinedAt));
    const invites = await db.select().from(inviteCodes).where(and(eq(inviteCodes.groupId, row.id), isNull(inviteCodes.usedAt))).orderBy(asc(inviteCodes.createdAt));
    res.json({ group: row, members, activeInvite: invites.find((invite) => !invite.expiresAt || invite.expiresAt > new Date()) ?? null });
  } catch (err) {
    req.log.error({ err }, "Failed to load group");
    res.status(500).json({ error: "Failed to load group" });
  }
});

router.post("/groups", async (req, res) => {
  const name = cleanText(req.body?.name, 80) || "New group";
  const conversationId = cleanText(req.body?.conversationId, 80);
  const kind = req.body?.kind === "ai" ? "ai" : "human";
  const ownerToken = randomBytes(32).toString("base64url");
  const groupId = conversationId || randomUUID();
  try {
    const [existingConversation] = conversationId
      ? await db.select().from(conversations).where(eq(conversations.id, conversationId))
      : [];
    if (conversationId && !existingConversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const [existingGroup] = await db.select().from(groupChats).where(eq(groupChats.id, groupId));
    if (existingGroup) {
      res.json({ group: existingGroup, created: false });
      return;
    }
    const [group] = await db.insert(groupChats).values({
      id: groupId,
      name,
      kind,
      ownerTokenHash: hashSecret(ownerToken),
    }).returning();
    if (!existingConversation) {
      await db.insert(conversations).values({ id: groupId, title: name });
    }
    await db.insert(groupMembers).values({ groupId: group.id, accountId: null, role: "owner" });
    if (kind === "ai") {
      await db.insert(groupMembers).values([
        { groupId: group.id, accountId: null, persona: "Researcher", role: "persona" },
        { groupId: group.id, accountId: null, persona: "Skeptic", role: "persona" },
      ]);
    }
    setCookie(res, OWNER_COOKIE, ownerToken, SESSION_TTL_MS);
    res.status(201).json({ group, created: true });
  } catch (err) {
    req.log.error({ err }, "Failed to create group");
    res.status(500).json({ error: "Failed to create group" });
  }
});

router.get("/groups/:id", async (req, res) => {
  try {
    const [group] = await db.select().from(groupChats).where(eq(groupChats.id, req.params.id));
    if (!group) {
      res.status(404).json({ error: "Group not found" });
      return;
    }
    if (!(await canAccessGroup(req, group))) {
      res.status(404).json({ error: "Group not found" });
      return;
    }
    const members = await db.select().from(groupMembers).where(eq(groupMembers.groupId, group.id)).orderBy(asc(groupMembers.joinedAt));
    res.json({ group, members });
  } catch (err) {
    res.status(500).json({ error: "Failed to load group" });
  }
});

router.post("/groups/:id/invite", async (req, res) => {
  const ownerToken = readCookie(req.headers.cookie, OWNER_COOKIE);
  try {
    const [group] = await db.select().from(groupChats).where(eq(groupChats.id, req.params.id));
    if (!group) {
      res.status(404).json({ error: "Group not found" });
      return;
    }
    if (!ownerToken || hashSecret(ownerToken) !== group.ownerTokenHash) {
      res.status(403).json({ error: "Only the group owner can create an invite" });
      return;
    }
    await db.update(inviteCodes).set({ usedAt: new Date() }).where(and(eq(inviteCodes.groupId, group.id), isNull(inviteCodes.usedAt)));
    const code = await uniqueInviteCode(group.id);
    const [invite] = await db.insert(inviteCodes).values({
      groupId: group.id,
      code,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    }).returning();
    res.status(201).json({ code: invite.code, expiresAt: invite.expiresAt });
  } catch (err) {
    req.log.error({ err }, "Failed to create invite");
    res.status(500).json({ error: "Failed to create invite" });
  }
});

router.post("/groups/join", async (req, res) => {
  const code = cleanText(req.body?.code, 4);
  const email = cleanText(req.body?.email, 240).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const displayName = cleanText(req.body?.displayName, 80);
  if (!/^\d{4}$/.test(code)) {
    res.status(400).json({ error: "Enter a 4-digit invite code" });
    return;
  }
  if (!email || !password || !displayName) {
    res.status(400).json({ error: "Email, display name, and password are required to join" });
    return;
  }
  try {
    const [invite] = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code));
    if (!invite || invite.usedAt || (invite.expiresAt && invite.expiresAt < new Date())) {
      res.status(404).json({ error: "That invite is invalid or expired" });
      return;
    }
    let [account] = await db.select().from(accounts).where(eq(accounts.email, email));
    if (account) {
      if (!verifyPassword(password, account.passwordHash)) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
    } else {
      [account] = await db.insert(accounts).values({ email, passwordHash: hashPassword(password), displayName }).returning();
    }
    const [existingMember] = await db.select().from(groupMembers).where(and(eq(groupMembers.groupId, invite.groupId), eq(groupMembers.accountId, account.id)));
    if (!existingMember) {
      await db.insert(groupMembers).values({ groupId: invite.groupId, accountId: account.id, role: "member" });
    }
    await db.update(inviteCodes).set({ usedAt: new Date() }).where(eq(inviteCodes.id, invite.id));
    await createSession(res, account.id);
    res.json({ groupId: invite.groupId, account: publicAccount(account) });
  } catch (err) {
    req.log.error({ err }, "Failed to join group");
    res.status(500).json({ error: "Failed to join group" });
  }
});

router.patch("/groups/:id", async (req, res) => {
  const ownerToken = readCookie(req.headers.cookie, OWNER_COOKIE);
  const name = cleanText(req.body?.name, 80);
  const aiToggle = req.body?.aiToggle === "mention" ? "mention" : req.body?.aiToggle === "always" ? "always" : undefined;
  if (!name && !aiToggle) {
    res.status(400).json({ error: "A group name or AI participation mode is required" });
    return;
  }
  try {
    const [group] = await db.select().from(groupChats).where(eq(groupChats.id, req.params.id));
    if (!group) {
      res.status(404).json({ error: "Group not found" });
      return;
    }
    if (!ownerToken || hashSecret(ownerToken) !== group.ownerTokenHash) {
      res.status(403).json({ error: "Only the group owner can update settings" });
      return;
    }
    const [updated] = await db.update(groupChats).set({
      ...(name ? { name } : {}),
      ...(aiToggle ? { aiToggle } : {}),
      updatedAt: new Date(),
    }).where(eq(groupChats.id, group.id)).returning();
    if (name) await db.update(conversations).set({ title: name, updatedAt: new Date() }).where(eq(conversations.id, group.id));
    res.json({ group: updated });
  } catch (err) {
    res.status(500).json({ error: "Failed to update group" });
  }
});

router.post("/groups/:id/leave", async (req, res) => {
  try {
    const account = await currentAccount(req);
    if (!account) {
      res.status(401).json({ error: "Sign in with the invited account before leaving" });
      return;
    }
    await db.delete(groupMembers).where(and(eq(groupMembers.groupId, req.params.id), eq(groupMembers.accountId, account.id)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to leave group" });
  }
});

router.get("/groups/:id/messages", async (req, res) => {
  try {
    const [group] = await db.select().from(groupChats).where(eq(groupChats.id, req.params.id));
    if (!group || !(await canAccessGroup(req, group))) {
      res.status(404).json({ error: "Group not found" });
      return;
    }
    const rows = await db.select().from(messages).where(eq(messages.conversationId, req.params.id)).orderBy(asc(messages.createdAt));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to load group messages" });
  }
});

export default router;

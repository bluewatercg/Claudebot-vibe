const { Telegraf } = require("telegraf");
const Anthropic = require("@anthropic-ai/sdk").default;
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const RAILWAY_API_TOKEN = process.env.RAILWAY_API_TOKEN;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN || !ANTHROPIC_API_KEY) {
  console.error("Missing BOT_TOKEN or ANTHROPIC_API_KEY");
  process.exit(1);
}


// Debug logging
console.log("=== ENV CHECK ===");
console.log("SUPABASE_URL:", SUPABASE_URL ? SUPABASE_URL.substring(0, 30) + "..." : "NOT SET");
console.log("SUPABASE_KEY:", SUPABASE_KEY ? SUPABASE_KEY.substring(0, 20) + "..." : "NOT SET");
console.log("Supabase client:", SUPABASE_URL && SUPABASE_KEY ? "WILL INIT" : "SKIPPED - missing vars");
console.log("================");
const bot = new Telegraf(BOT_TOKEN);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
if (supabase) {
  supabase.from("user_docs").select("count", { count: "exact", head: true }).then(function(res) {
    if (res.error) { console.error("Supabase TEST FAILED:", res.error.message); }
    else { console.log("Supabase TEST OK - connected successfully"); }
  }).catch(function(err) { console.error("Supabase ERROR:", err.message); });
} else { console.log("Supabase NOT initialized - check SUPABASE_URL and SUPABASE_KEY"); }

const memoryStore = new Map();
const docsStore = new Map();
const summaryStore = new Map();
const vectorStore = new Map();
const processingLock = new Map(); // prevent concurrent processing per user
const docsCache = new Map(); // cache docs for 60 seconds
const CACHE_TTL = 60000;

function getCachedDoc(userId, docType) {
  const key = userId + "_" + docType;
  const cached = docsCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.value;
  return null;
}

function setCachedDoc(userId, docType, value) {
  docsCache.set(userId + "_" + docType, { value, ts: Date.now() });
}

function invalidateDocCache(userId, docType) {
  docsCache.delete(userId + "_" + docType);
}

async function withLock(userId, fn) {
  if (processingLock.get(userId)) {
    return null; // skip if already processing
  }
  processingLock.set(userId, true);
  try {
    return await fn();
  } finally {
    processingLock.delete(userId);
  }
}

const RECENT_MESSAGES = 50;
const MAX_SUMMARIES = 8;
const SUMMARIZE_EVERY = 20;
const TOP_MEMORIES = 12;

// ── 对话记录 ──────────────────────────────────────────────────────────────────
async function getHistory(userId) {
  if (supabase) {
    try {
      const { data } = await supabase
        .from("conversations")
        .select("role, content")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(RECENT_MESSAGES);
      return (data || []).reverse();
    } catch (err) { console.error("getHistory error:", err.message); }
  }
  const h = memoryStore.get(userId) || [];
  return h.slice(-RECENT_MESSAGES);
}

async function saveMessage(userId, role, content) {
  if (supabase) {
    try {
      await supabase.from("conversations").insert({ user_id: userId, role, content });
      return;
    } catch (err) { console.error("saveMessage error:", err.message); }
  }
  if (!memoryStore.has(userId)) memoryStore.set(userId, []);
  const h = memoryStore.get(userId);
  h.push({ role, content });
  if (h.length > 100) h.splice(0, h.length - 100);
}

async function countMessages(userId) {
  if (supabase) {
    try {
      const { count } = await supabase
        .from("conversations")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);
      return count || 0;
    } catch (err) { return 0; }
  }
  return (memoryStore.get(userId) || []).length;
}

async function clearHistory(userId) {
  if (supabase) {
    try {
      await supabase.from("conversations").delete().eq("user_id", userId);
      await supabase.from("conversation_summaries").delete().eq("user_id", userId);
      await supabase.from("memories").delete().eq("user_id", userId);
      return;
    } catch (err) { console.error("clearHistory error:", err.message); }
  }
  memoryStore.delete(userId);
  summaryStore.delete(userId);
  vectorStore.delete(userId);
}

// ── .md 文件操作 ──────────────────────────────────────────────────────────────
async function getDoc(userId, docType) {
  const cached = getCachedDoc(userId, docType);
  if (cached !== null) return cached;
  if (supabase) {
    try {
      const uid = parseInt(userId);
      const { data, error } = await supabase
        .from("user_docs")
        .select("content", { count: "exact" })
        .eq("user_id", uid)
        .eq("doc_type", docType);
      if (error) { console.error("getDoc error:", docType, error.message); return null; }
      const value = (data && data.length > 0) ? data[0].content : null;
      setCachedDoc(userId, docType, value);
      return value;
    } catch (err) {
      console.error("getDoc exception:", err.message);
      return null;
    }
  }
  return docsStore.get(userId + "_" + docType) || null;
}

async function setDoc(userId, docType, content) {
  console.log("setDoc called - userId:", userId, "docType:", docType);
  if (supabase) {
    try {
      const result = await supabase.from("user_docs").upsert(
        { user_id: parseInt(userId), doc_type: docType, content: content, updated_at: new Date().toISOString() },
        { onConflict: "user_id,doc_type" }
      );
      if (result.error) {
        console.error("setDoc upsert error:", JSON.stringify(result.error));
      } else {
        console.log("setDoc SUCCESS - userId:", userId, "docType:", docType);
      invalidateDocCache(userId, docType);
      }
      return;
    } catch (err) { console.error("setDoc exception:", err.message); }
  } else {
    console.log("setDoc - supabase not available, using memory");
  }
  docsStore.set(userId + "_" + docType, content);
}

async function getAllDocs(userId) {
  const types = ["soul", "projects", "tasks", "notes"];
  const docs = {};
  for (const t of types) {
    const content = await getDoc(userId, t);
    if (content) docs[t] = content;
  }
  return docs;
}

// ── 摘要操作 ──────────────────────────────────────────────────────────────────
async function getSummaries(userId) {
  if (supabase) {
    try {
      const { data } = await supabase
        .from("conversation_summaries")
        .select("summary")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(MAX_SUMMARIES);
      return (data || []).map(function(d) { return d.summary; }).reverse();
    } catch (err) { return []; }
  }
  return summaryStore.get(userId) || [];
}

async function saveSummary(userId, summary) {
  if (supabase) {
    try {
      await supabase.from("conversation_summaries").insert({ user_id: userId, summary: summary });
      const { data } = await supabase
        .from("conversation_summaries")
        .select("id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (data && data.length > MAX_SUMMARIES) {
        const toDelete = data.slice(MAX_SUMMARIES).map(function(d) { return d.id; });
        await supabase.from("conversation_summaries").delete().in("id", toDelete);
      }
      return;
    } catch (err) { console.error("saveSummary error:", err.message); }
  }
  if (!summaryStore.has(userId)) summaryStore.set(userId, []);
  const s = summaryStore.get(userId);
  s.push(summary);
  if (s.length > MAX_SUMMARIES) s.splice(0, s.length - MAX_SUMMARIES);
}

// ── 向量记忆 ──────────────────────────────────────────────────────────────────
async function embedText(text) {
  if (!VOYAGE_API_KEY) return null;
  try {
    const response = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + VOYAGE_API_KEY },
      body: JSON.stringify({ model: "voyage-3", input: [text] })
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.data && data.data[0] ? data.data[0].embedding : null;
  } catch (err) { return null; }
}

async function saveMemory(userId, content, memoryType) {
  const embedding = await embedText(content);
  if (supabase && embedding) {
    try {
      await supabase.from("memories").insert({
        user_id: userId,
        content: content,
        memory_type: memoryType || "general",
        embedding: JSON.stringify(embedding)
      });
      return;
    } catch (err) { console.error("saveMemory error:", err.message); }
  }
  if (!vectorStore.has(userId)) vectorStore.set(userId, []);
  vectorStore.get(userId).push({ content, memoryType, embedding });
}

async function searchMemories(userId, query) {
  // 如果向量功能不可用，直接返回空（不崩溃）
  if (!VOYAGE_API_KEY) return [];
  const queryEmbedding = await embedText(query);
  if (!queryEmbedding) return [];

  if (supabase) {
    try {
      // 用原始 SQL 查询代替 RPC 函数，更可靠
      const embeddingStr = JSON.stringify(queryEmbedding);
      const { data, error } = await supabase
        .from("memories")
        .select("content")
        .eq("user_id", userId)
        .limit(TOP_MEMORIES);
      if (error) throw error;
      return (data || []).map(function(d) { return d.content; });
    } catch (err) {
      console.error("searchMemories error:", err.message);
      return [];
    }
  }

  // 内存 fallback
  const memories = vectorStore.get(userId) || [];
  if (memories.length === 0) return [];

  function cosine(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
  }

  return memories
    .filter(function(m) { return m.embedding; })
    .map(function(m) { return { content: m.content, score: cosine(queryEmbedding, m.embedding) }; })
    .sort(function(a, b) { return b.score - a.score; })
    .slice(0, TOP_MEMORIES)
    .map(function(m) { return m.content; });
}

// ── 自动学习 ──────────────────────────────────────────────────────────────────
async function autoLearnMemory(userId, userMessage, aiReply) {
  // Quick check: is this conversation worth learning from?
  try {
    const worthCheck = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 5,
      messages: [{ role: "user", content: "Does this conversation contain new facts, preferences, projects or decisions worth remembering long-term? Answer YES or NO only.\n\nUser: " + userMessage.substring(0, 200) + "\nAssistant: " + aiReply.substring(0, 200) }]
    });
    const worth = (worthCheck.content[0] || {}).text || "NO";
    if (!worth.toUpperCase().includes("YES")) return;
  } catch (e) { return; }
  try {
    const docs = await getAllDocs(userId);
    const currentDocs = JSON.stringify(docs, null, 2);

    const extractPrompt = "You are a memory extraction system. Analyze this conversation and return a JSON object.\n\n" +
      "CURRENT MEMORY:\n" + currentDocs + "\n\n" +
      "NEW EXCHANGE:\nUser: " + userMessage.substring(0, 500) + "\nAI: " + aiReply.substring(0, 500) + "\n\n" +
      "Extract only genuinely NEW information not already in memory.\n" +
      "Return ONLY this exact JSON with no other text:\n" +
      '{"soul":"","projects":"","tasks":"","notes":"","memories":[]}';

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [{ role: "user", content: extractPrompt }]
    });

    const raw = response.content[0] ? response.content[0].text.trim() : "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    const updates = JSON.parse(jsonMatch[0]);

    if (updates.soul && updates.soul.trim()) await setDoc(userId, "soul", updates.soul.trim());
    if (updates.projects && updates.projects.trim()) await setDoc(userId, "projects", updates.projects.trim());
    if (updates.tasks && updates.tasks.trim()) await setDoc(userId, "tasks", updates.tasks.trim());
    if (updates.notes && updates.notes.trim()) {
      const existing = await getDoc(userId, "notes") || "";
      const timestamp = new Date().toISOString().split("T")[0];
      const newNotes = existing ? existing + "\n[" + timestamp + "] " + updates.notes.trim() : "[" + timestamp + "] " + updates.notes.trim();
      await setDoc(userId, "notes", newNotes);
    }
    if (updates.memories && Array.isArray(updates.memories)) {
      for (const fact of updates.memories) {
        if (fact && typeof fact === "string" && fact.trim()) await saveMemory(userId, fact.trim(), "learned");
      }
    }
    await saveMemory(userId, "User said: " + userMessage.substring(0, 200), "conversation");
  } catch (err) {
    console.error("autoLearnMemory error:", err.message);
  }
}

// ── 自动摘要 ──────────────────────────────────────────────────────────────────
async function maybeAutoSummarize(userId) {
  const count = await countMessages(userId);
  if (count > 0 && count % SUMMARIZE_EVERY === 0) {
    try {
      const history = await getHistory(userId);
      const historyText = history.map(function(m) {
        return (m.role === "user" ? "用户" : "AI") + ": " + m.content;
      }).join("\n");
      const response = await anthropic.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 500,
        messages: [{ role: "user", content: "请把以下对话压缩成简短摘要（100字以内），保留重要信息。用中文。\n\n" + historyText }]
      });
      const summary = response.content[0] ? response.content[0].text : "";
      if (summary) {
        await saveSummary(userId, summary);
        await saveMemory(userId, summary, "summary");
      }
    } catch (err) { console.error("Auto-summarize error:", err.message); }
  }
}

// ── 网络搜索（直接调用，不用 Claude tools）──────────────────────────────────
async function tavilySearch(query) {
  if (!TAVILY_API_KEY) return null;
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: TAVILY_API_KEY, query: query, max_results: 5, search_depth: "basic" })
    });
    if (!response.ok) return null;
    const data = await response.json();
    const results = data.results || [];
    if (results.length === 0) return null;
    return results.map(function(r, i) {
      return (i + 1) + ". " + (r.title || "") + "\n" + (r.content || r.snippet || r.url || "");
    }).join("\n\n");
  } catch (err) {
    console.error("Tavily error:", err.message);
    return null;
  }
}

// 用 Claude 智能判断是否需要搜索
async function needsSearch(message) {
  if (!TAVILY_API_KEY) return false;
  // Skip search for very short messages
  if (message.length < 15) return false;
  // Skip search for pure code/debug messages
  if (message.startsWith("```") || message.includes("error:") && message.length < 50) return false;
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 10,
      messages: [{
        role: "user",
        content: "Does this question require real-time or current information to answer accurately? Answer only YES or NO.\n\nQuestion: " + message
      }]
    });
    const answer = response.content[0] ? response.content[0].text.trim().toUpperCase() : "NO";
    return answer.includes("YES");
  } catch (err) {
    return false;
  }
}

// ── 组装系统提示 ──────────────────────────────────────────────────────────────
async function buildSystemPrompt(userId, userMessage) {
  const [docs, summaries, relevantMemories] = await Promise.all([
    getAllDocs(userId),
    getSummaries(userId),
    searchMemories(userId, userMessage)
  ]);

  let prompt = "You are a smart, powerful personal AI assistant with advanced memory.\n\n";
  prompt += "FORMATTING RULES:\n";
  prompt += "- Never use Markdown symbols like *, _, **, __ in regular text replies\n";
  prompt += "- Plain text only for normal replies - dashes for lists, numbers for steps\n";
  prompt += "- CODE EXCEPTION: Always wrap ALL code in proper code blocks using triple backticks\n";
  prompt += "- For code blocks, always specify the language: ```python, ```javascript, ```bash etc\n";
  prompt += "- When sharing code fixes, always show the COMPLETE fixed code, not just the changed lines\n";
  prompt += "- When fixing bugs, explain: 1) what was wrong 2) what you changed 3) show full fixed code\n";
  prompt += "- Emojis are fine\n";
  prompt += "- Short questions = concise replies\n";
  prompt += "- Detailed tasks = full complete replies without stopping\n";
  prompt += "- Always reply in the same language the user wrote in\n";
  prompt += "- Never stop mid-reply\n";
  prompt += "- For code: ALWAYS write the complete code in ONE reply, never split across messages\n";
  prompt += "- If code is long, still write it all - it will be sent as a file automatically\n\n";

  if (docs.soul) prompt += "=== WHO THE USER IS ===\n" + docs.soul + "\n\n";
  if (docs.projects) prompt += "=== USER PROJECTS ===\n" + docs.projects + "\n\n";
  if (docs.tasks) prompt += "=== CURRENT TASKS ===\n" + docs.tasks + "\n\n";
  if (docs.notes) prompt += "=== IMPORTANT NOTES ===\n" + docs.notes + "\n\n";

  if (relevantMemories.length > 0) {
    prompt += "=== RELEVANT MEMORIES ===\n";
    relevantMemories.forEach(function(m, i) { prompt += (i + 1) + ". " + m + "\n"; });
    prompt += "\n";
  }

  if (summaries.length > 0) {
    prompt += "=== CONVERSATION SUMMARIES ===\n";
    summaries.forEach(function(s, i) { prompt += "Summary " + (i + 1) + ": " + s + "\n"; });
    prompt += "\n";
  }

  return prompt;
}

// ── Claude 主函数（不用 tools，直接搜索）─────────────────────────────────────
async function askClaude(userId, userMessage, ctx) {
  await saveMessage(userId, "user", userMessage);

  const [systemPrompt, history] = await Promise.all([
    buildSystemPrompt(userId, userMessage),
    getHistory(userId)
  ]);

  let messages = history.length > 0 ? [...history] : [{ role: "user", content: userMessage }];
  let activeSystemPrompt = systemPrompt;

  // 如果需要搜索，先搜索再把结果加进对话
  if ((await needsSearch(userMessage)) && TAVILY_API_KEY) {
    const searchResults = await tavilySearch(userMessage);
    if (searchResults) {
      activeSystemPrompt = systemPrompt + "=== WEB SEARCH RESULTS ===\nToday is 2026. IMPORTANT: Base your answer primarily on these search results, not your training data. If results show current info, use it.\n" + searchResults + "\n\n";
    }
  }

  // Streaming response
  let reply = "";
  let sentMsg = null;
  let lastUpdate = 0;
  const UPDATE_INTERVAL = 1500; // update every 1.5 seconds

  try {
    const stream = anthropic.messages.stream({
      model: "claude-opus-4-5",
      max_tokens: 8192,
      system: activeSystemPrompt,
      messages: messages
    });

    // Send initial placeholder
    if (ctx) sentMsg = await ctx.reply("...");

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta && event.delta.type === "text_delta") {
        reply += event.delta.text;
        const now = Date.now();
        if (ctx && sentMsg && now - lastUpdate > UPDATE_INTERVAL && reply.length > 10) {
          try {
            await ctx.telegram.editMessageText(ctx.chat.id, sentMsg.message_id, null, reply.substring(0, 4000) + (reply.length > 4000 ? "..." : ""));
            lastUpdate = now;
          } catch (e) { /* ignore edit errors */ }
        }
      }
    }

    // Final update or send full response
    if (ctx && sentMsg) {
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, sentMsg.message_id);
      } catch (e) { /* ignore */ }
    }
  } catch (err) {
    console.error("Stream error:", err.message);
    // Fallback to non-streaming
    if (!reply) {
      const response = await anthropic.messages.create({
        model: "claude-opus-4-5", max_tokens: 8192,
        system: activeSystemPrompt, messages: messages
      });
      reply = (response.content.find(function(b) { return b.type === "text"; }) || {}).text || "出错了，请再试一次。";
    }
  }

  await saveMessage(userId, "assistant", reply);
  countMessages(userId).then(function(count) {
    const tasks = [maybeAutoSummarize(userId)];
    if (count % 5 === 0) tasks.push(autoLearnMemory(userId, userMessage, reply));
    return Promise.all(tasks);
  }).catch(function(err) { console.error("Background error:", err.message); });

  return reply;
}

// ── 发送长消息 ────────────────────────────────────────────────────────────────
async function sendLongMessage(ctx, text) {
  const MAX = 3800;
  if (text.length <= MAX) { await ctx.reply(text); return; }

  // If response contains code and is very long, send as file
  const hasCode = text.includes("```");
  if (hasCode && text.length > MAX) {
    // Send a short summary first
    const lines = text.split("\n");
    const summary = lines.slice(0, 8).join("\n") + "\n\n[代码太长，以文件形式发送 👇]";
    await ctx.reply(summary);

    // Send as .txt file
    const buf = Buffer.from(text, "utf-8");
    const ts = new Date().toISOString().slice(11,16).replace(":","");
    await ctx.replyWithDocument({ source: buf, filename: "code_" + ts + ".txt" }, { caption: "完整代码（直接复制粘贴）" });
    return;
  }

  // For long non-code text, split by paragraph
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX) { chunks.push(remaining); break; }
    let splitAt = remaining.lastIndexOf("\n\n", MAX);
    if (splitAt === -1) splitAt = remaining.lastIndexOf("\n", MAX);
    if (splitAt === -1 || splitAt < 100) splitAt = MAX;
    chunks.push(remaining.substring(0, splitAt).trim());
    remaining = remaining.substring(splitAt).trim();
  }

  for (let i = 0; i < chunks.length; i++) {
    const suffix = chunks.length > 1 && i < chunks.length - 1 ? "\n\n[" + (i+1) + "/" + chunks.length + "]" : "";
    await ctx.reply(chunks[i] + suffix);
    if (i < chunks.length - 1) await new Promise(function(r) { setTimeout(r, 300); });
  }
}

// ── Bot 命令 ──────────────────────────────────────────────────────────────────
bot.start(function(ctx) {
  const name = ctx.from && ctx.from.first_name ? ctx.from.first_name : "there";
  return ctx.reply(
    "Hey " + name + "! Your personal AI powered by Claude.\n\n" +
    "Memory system (4 layers):\n" +
    "- soul.md + projects.md - permanent identity\n" +
    "- tasks.md + notes.md - dynamic knowledge\n" +
    "- Vector memory - semantic search\n" +
    "- Conversation summaries\n\n" +
    "/help - all commands\n" +
    "/memory - see what I know about you"
  );
});

bot.help(function(ctx) {
  return ctx.reply(
    "All commands:\n\n" +
    "VIEW:\n" +
    "/memory - full overview\n" +
    "/soul - who you are\n" +
    "/projects - your projects\n" +
    "/tasks - current tasks\n" +
    "/notes - saved notes\n" +
    "/summaries - conversation summaries\n\n" +
    "UPDATE:\n" +
    "/setsoul [content]\n" +
    "/setprojects [content]\n" +
    "/settasks [content]\n" +
    "/note [text]\n" +
    "/clearnotes\n" +
    "/summarize\n\n" +
    "MANAGE:\n" +
    "/forget - clear conversation only\n" +
    "/reset - clear everything"
  );
});



// ── Railway 自动部署 ───────────────────────────────────────────────────────────
async function railwayDeploy(repoUrl, projectName, envVars) {
  const headers = {
    "Authorization": "Bearer " + RAILWAY_API_TOKEN,
    "Content-Type": "application/json"
  };

  // Step 1: Create project
  const createProjectRes = await fetch("https://backboard.railway.app/graphql/v2", {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: `mutation { projectCreate(input: { name: "${projectName}" }) { id name } }`
    })
  });
  const projectData = await createProjectRes.json();
  const projectId = projectData.data && projectData.data.projectCreate && projectData.data.projectCreate.id;
  if (!projectId) throw new Error("Failed to create Railway project: " + JSON.stringify(projectData));

  // Step 2: Create service from GitHub repo
  const repoPath = repoUrl.replace("https://github.com/", "");
  const createServiceRes = await fetch("https://backboard.railway.app/graphql/v2", {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: `mutation { serviceCreate(input: { projectId: "${projectId}", name: "${projectName}", source: { repo: "${repoPath}" } }) { id name } }`
    })
  });
  const serviceData = await createServiceRes.json();
  const serviceId = serviceData.data && serviceData.data.serviceCreate && serviceData.data.serviceCreate.id;
  if (!serviceId) throw new Error("Failed to create Railway service: " + JSON.stringify(serviceData));

  // Step 3: Get environment ID
  const envRes = await fetch("https://backboard.railway.app/graphql/v2", {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: `query { project(id: "${projectId}") { environments { edges { node { id name } } } } }`
    })
  });
  const envData = await envRes.json();
  const envId = envData.data && envData.data.project && envData.data.project.environments &&
    envData.data.project.environments.edges[0] && envData.data.project.environments.edges[0].node.id;

  // Step 4: Set environment variables if provided
  if (envVars && envId) {
    for (const [key, value] of Object.entries(envVars)) {
      await fetch("https://backboard.railway.app/graphql/v2", {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: `mutation { variableUpsert(input: { projectId: "${projectId}", environmentId: "${envId}", serviceId: "${serviceId}", name: "${key}", value: "${value}" }) }`
        })
      });
    }
  }

  // Step 5: Generate domain
  const domainRes = await fetch("https://backboard.railway.app/graphql/v2", {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: `mutation { serviceDomainCreate(input: { serviceId: "${serviceId}", environmentId: "${envId}" }) { domain } }`
    })
  });
  const domainData = await domainRes.json();
  const domain = domainData.data && domainData.data.serviceDomainCreate && domainData.data.serviceDomainCreate.domain;

  return {
    projectId,
    serviceId,
    url: domain ? "https://" + domain : "https://railway.app/project/" + projectId
  };
}

// ── Vibe Coding ───────────────────────────────────────────────────────────────
const vibeSessions = new Map();

async function getGitHubUser() {
  const res = await fetch("https://api.github.com/user", {
    headers: { "Authorization": "token " + GITHUB_TOKEN, "User-Agent": "ClaudeBot" }
  });
  return await res.json();
}

async function createGitHubRepo(repoName, description) {
  const res = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: { "Authorization": "token " + GITHUB_TOKEN, "Content-Type": "application/json", "User-Agent": "ClaudeBot" },
    body: JSON.stringify({ name: repoName, description: description || "Created by Claude Bot", private: false, auto_init: false })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Failed to create repo");
  return data;
}

async function pushFilesToGitHub(owner, repoName, files) {
  const headers = { "Authorization": "token " + GITHUB_TOKEN, "Content-Type": "application/json", "User-Agent": "ClaudeBot" };
  const base = "https://api.github.com/repos/" + owner + "/" + repoName;
  let treeSha, commitSha;

  const branchRes = await fetch(base + "/git/ref/heads/main", { headers });
  if (branchRes.ok) {
    const bd = await branchRes.json();
    commitSha = bd.object.sha;
    const cd = await (await fetch(base + "/git/commits/" + commitSha, { headers })).json();
    treeSha = cd.tree.sha;
  }

  const treeItems = [];
  for (const [path, fileContent] of Object.entries(files)) {
    const blob = await (await fetch(base + "/git/blobs", {
      method: "POST", headers,
      body: JSON.stringify({ content: fileContent, encoding: "utf-8" })
    })).json();
    treeItems.push({ path, mode: "100644", type: "blob", sha: blob.sha });
  }

  const treeBody = { tree: treeItems };
  if (treeSha) treeBody.base_tree = treeSha;
  const tree = await (await fetch(base + "/git/trees", { method: "POST", headers, body: JSON.stringify(treeBody) })).json();

  const commitBody = { message: "Initial commit by Claude Bot", tree: tree.sha };
  if (commitSha) commitBody.parents = [commitSha];
  const newCommit = await (await fetch(base + "/git/commits", { method: "POST", headers, body: JSON.stringify(commitBody) })).json();

  if (branchRes.ok) {
    await fetch(base + "/git/refs/heads/main", { method: "PATCH", headers, body: JSON.stringify({ sha: newCommit.sha, force: true }) });
  } else {
    await fetch(base + "/git/refs", { method: "POST", headers, body: JSON.stringify({ ref: "refs/heads/main", sha: newCommit.sha }) });
  }
  return "https://github.com/" + owner + "/" + repoName;
}

async function generateProjectFiles(idea, techStack, details) {
  const prompt = "You are an expert developer. Generate a complete, production-ready project.\n\nPROJECT IDEA: " + idea + "\nTECH STACK: " + techStack + "\nADDITIONAL DETAILS: " + (details || "none") + "\n\nReturn a JSON object where keys are file paths and values are file contents. Include ALL necessary files: main code, package.json or requirements.txt, README.md, .gitignore, and config files. Make the code complete and runnable - no placeholders.\n\nReturn ONLY valid JSON, no explanation, no markdown backticks.";
  const res = await anthropic.messages.create({ model: "claude-opus-4-5", max_tokens: 4096, messages: [{ role: "user", content: prompt }] });
  const text = (res.content[0] || {}).text || "{}";
  const clean = text.replace(/^```json\n?|^```\n?|```$/gm, "").trim();
  return JSON.parse(clean);
}

async function reviewAndFixFiles(files, idea, techStack) {
  const filesSummary = Object.entries(files).map(function(entry) {
    const path = entry[0];
    const code = entry[1];
    return "=== " + path + " ===\n" + code.substring(0, 1500) + (code.length > 1500 ? "\n...[truncated]" : "");
  }).join("\n\n");

  const reviewPrompt = "You are a senior developer reviewing code before deployment.\n\nProject idea: " + idea + "\nTech stack: " + techStack + "\n\nGenerated files:\n" + filesSummary + "\n\nReview the code and fix any issues:\n1. Syntax errors or typos\n2. Missing imports or dependencies\n3. Broken logic or incomplete functions\n4. Security issues (hardcoded secrets, etc)\n5. Missing error handling\n\nReturn ONLY a JSON object with the fixed files (same structure: filepath -> content). If a file is fine, include it unchanged. Return ONLY valid JSON, no explanation.";

  const res = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 8192,
    messages: [{ role: "user", content: reviewPrompt }]
  });
  const text = (res.content[0] || {}).text || "{}";
  const clean = text.replace(/^```json\n?|^```\n?|```$/gm, "").trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    console.error("Review parse error:", e.message);
    return files; // return original if review fails
  }
}

bot.command("vibe", async function(ctx) {
  if (!GITHUB_TOKEN) return ctx.reply("Vibe coding 未启用。请在 Railway 添加 GITHUB_TOKEN 环境变量。");
  const userId = ctx.from.id;
  vibeSessions.set(userId, { step: "idea" });
  await ctx.reply("🚀 Vibe Coding 模式启动！\n\n说说你想做什么？（一句话描述你的项目想法）");
});

bot.command("vibestop", async function(ctx) {
  vibeSessions.delete(ctx.from.id);
  await ctx.reply("已退出 Vibe Coding 模式。");
});

bot.command("memory", async function(ctx) {
  await ctx.sendChatAction("typing");
  const docs = await getAllDocs(ctx.from.id);
  const summaries = await getSummaries(ctx.from.id);
  let output = "Your memory overview:\n\n";
  output += "SOUL:\n" + (docs.soul || "Not set yet") + "\n\n";
  output += "PROJECTS:\n" + (docs.projects || "Not set yet") + "\n\n";
  output += "TASKS:\n" + (docs.tasks || "Not set yet") + "\n\n";
  if (docs.notes) output += "NOTES:\n" + docs.notes + "\n\n";
  output += "VECTOR MEMORIES: Active\n";
  if (summaries.length > 0) output += "SUMMARIES: " + summaries.length + " saved";
  await sendLongMessage(ctx, output);
});

bot.command("soul", async function(ctx) {
  const content = await getDoc(ctx.from.id, "soul");
  await ctx.reply(content ? "soul.md:\n\n" + content : "Not set yet. Talk to me and I will learn automatically!");
});

bot.command("setsoul", async function(ctx) {
  const content = ctx.message.text.replace("/setsoul", "").trim();
  if (!content) return ctx.reply("Usage: /setsoul [your info]");
  await setDoc(ctx.from.id, "soul", content);
  return ctx.reply("soul.md updated!");
});

bot.command("projects", async function(ctx) {
  const content = await getDoc(ctx.from.id, "projects");
  await ctx.reply(content ? "projects.md:\n\n" + content : "Not set yet.");
});

bot.command("setprojects", async function(ctx) {
  const content = ctx.message.text.replace("/setprojects", "").trim();
  if (!content) return ctx.reply("Usage: /setprojects [content]");
  await setDoc(ctx.from.id, "projects", content);
  return ctx.reply("projects.md updated!");
});

bot.command("tasks", async function(ctx) {
  const content = await getDoc(ctx.from.id, "tasks");
  await ctx.reply(content ? "tasks.md:\n\n" + content : "Not set yet.");
});

bot.command("settasks", async function(ctx) {
  const content = ctx.message.text.replace("/settasks", "").trim();
  if (!content) return ctx.reply("Usage: /settasks [content]");
  await setDoc(ctx.from.id, "tasks", content);
  return ctx.reply("tasks.md updated!");
});

bot.command("notes", async function(ctx) {
  const content = await getDoc(ctx.from.id, "notes");
  if (content) { await sendLongMessage(ctx, "notes.md:\n\n" + content); }
  else { await ctx.reply("No notes yet."); }
});

bot.command("note", async function(ctx) {
  const newNote = ctx.message.text.replace("/note", "").trim();
  if (!newNote) return ctx.reply("Usage: /note [text]");
  const existing = await getDoc(ctx.from.id, "notes") || "";
  const timestamp = new Date().toISOString().split("T")[0];
  const updated = existing ? existing + "\n[" + timestamp + "] " + newNote : "[" + timestamp + "] " + newNote;
  await setDoc(ctx.from.id, "notes", updated);
  return ctx.reply("Note saved!");
});

bot.command("clearnotes", async function(ctx) {
  await setDoc(ctx.from.id, "notes", "");
  return ctx.reply("Notes cleared!");
});

bot.command("summaries", async function(ctx) {
  const summaries = await getSummaries(ctx.from.id);
  if (summaries.length > 0) {
    await sendLongMessage(ctx, "Summaries:\n\n" + summaries.map(function(s, i) { return (i + 1) + ". " + s; }).join("\n\n"));
  } else {
    await ctx.reply("No summaries yet. Auto-created every " + SUMMARIZE_EVERY + " messages.");
  }
});

bot.command("summarize", async function(ctx) {
  await ctx.sendChatAction("typing");
  try {
    const history = await getHistory(ctx.from.id);
    if (history.length === 0) return ctx.reply("No conversation to summarize.");
    const historyText = history.map(function(m) { return (m.role === "user" ? "用户" : "AI") + ": " + m.content; }).join("\n");
    const response = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 500,
      messages: [{ role: "user", content: "请把以下对话压缩成简短摘要（100字以内）。用中文。\n\n" + historyText }]
    });
    const summary = response.content[0] ? response.content[0].text : "";
    if (summary) {
      await saveSummary(ctx.from.id, summary);
      await ctx.reply("Summary saved:\n\n" + summary);
    }
  } catch (err) { await ctx.reply("Error creating summary."); }
});

bot.command("forget", async function(ctx) {
  await clearHistory(ctx.from.id);
  return ctx.reply("Conversation history cleared. soul, projects, tasks and notes kept.");
});

bot.command("reset", async function(ctx) {
  await clearHistory(ctx.from.id);
  for (const t of ["soul", "projects", "tasks", "notes"]) {
    await setDoc(ctx.from.id, t, "");
  }
  return ctx.reply("Everything cleared. Fresh start.");
});

// ── 处理文字消息 ──────────────────────────────────────────────────────────────

bot.command("deploy", async function(ctx) {
  if (!RAILWAY_API_TOKEN) return ctx.reply("Railway 部署未启用。请在 Railway Variables 添加 RAILWAY_API_TOKEN。");
  if (!GITHUB_TOKEN) return ctx.reply("需要 GITHUB_TOKEN 才能部署。");

  const args = ctx.message.text.split(" ").slice(1);
  const repoUrl = args[0];

  if (!repoUrl || !repoUrl.includes("github.com")) {
    return ctx.reply("用法：/deploy https://github.com/user/repo\n\n可以加环境变量：\n/deploy https://github.com/user/repo KEY1=val1 KEY2=val2");
  }

  const envVars = {};
  args.slice(1).forEach(function(arg) {
    const [key, ...rest] = arg.split("=");
    if (key && rest.length) envVars[key] = rest.join("=");
  });

  const projectName = repoUrl.split("/").pop().substring(0, 30);
  await ctx.reply("🚀 开始部署 " + projectName + "...\n\n[1/3] 创建 Railway 项目");
  await ctx.sendChatAction("typing");

  try {
    await ctx.reply("[2/3] 连接 GitHub repo，配置环境变量...");
    const result = await railwayDeploy(repoUrl, projectName, envVars);
    await ctx.reply("✅ 部署完成！\n\n🌐 URL: " + result.url + "\n📦 项目: https://railway.app/project/" + result.projectId + "\n\n几分钟后即可访问。");
  } catch (err) {
    console.error("Deploy error:", err.message);
    await ctx.reply("部署失败: " + err.message);
  }
});

bot.on("text", async function(ctx) {
  const userId = ctx.from.id;
  const userMessage = ctx.message.text;

  // Handle vibe coding session
  if (vibeSessions.has(userId) && !userMessage.startsWith("/")) {
    const session = vibeSessions.get(userId);

    if (session.step === "idea") {
      session.idea = userMessage;
      session.step = "stack";
      vibeSessions.set(userId, session);
      return ctx.reply("💡 好的！用什么技术栈？\n\n例如：Node.js, Python, React, Next.js 等\n（不确定就说 '帮我选'）");
    }

    if (session.step === "stack") {
      let stack = userMessage;
      if (userMessage.toLowerCase().includes("帮我选") || userMessage.toLowerCase().includes("你选")) {
        stack = "Node.js + Express";
      }
      session.stack = stack;
      session.step = "details";
      vibeSessions.set(userId, session);
      return ctx.reply("📝 还有什么额外要求？\n\n例如：需要数据库、特定 API、特殊功能\n（没有就发 '没有'）");
    }

    if (session.step === "details") {
      session.details = userMessage;
      session.step = "building";
      vibeSessions.set(userId, session);
      await ctx.reply("⚙️ 开始生成项目...请稍等 30-60 秒");
      await ctx.sendChatAction("typing");

      try {
        // Step 1: Generate
        await ctx.reply("⚙️ [1/3] 生成代码中...");
        const files = await generateProjectFiles(session.idea, session.stack, session.details);
        const fileCount = Object.keys(files).length;
        await ctx.reply("✅ 生成了 " + fileCount + " 个文件");

        // Step 2: Review + Fix
        await ctx.reply("🔍 [2/3] 代码审查中，修复潜在问题...");
        await ctx.sendChatAction("typing");
        const reviewedFiles = await reviewAndFixFiles(files, session.idea, session.stack);
        const reviewedCount = Object.keys(reviewedFiles).length;
        await ctx.reply("✅ 审查完成，共 " + reviewedCount + " 个文件准备就绪");

        // Step 3: Push to GitHub
        await ctx.reply("📦 [3/3] 推送到 GitHub 中...");
        const ghUser = await getGitHubUser();
        const owner = ghUser.login;
        const repoName = session.idea.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim().split(/\s+/).slice(0, 4).join("-") + "-" + Date.now().toString().slice(-4);

        await createGitHubRepo(repoName, session.idea);
        const repoUrl = await pushFilesToGitHub(owner, repoName, reviewedFiles);
        vibeSessions.delete(userId);

        const fileList = Object.keys(reviewedFiles).map(function(f) { return "- " + f; }).join("\n");
        await ctx.reply("🎉 完成！\n\n📦 GitHub: " + repoUrl + "\n\n文件:\n" + fileList + "\n\n下一步:\n1. Railway → New Project → Deploy from GitHub\n2. 选择 " + repoName + "\n3. 部署完成 ✅");
      } catch (err) {
        console.error("Vibe error:", err.message);
        vibeSessions.delete(userId);
        await ctx.reply("生成失败: " + err.message + "\n\n请重新发 /vibe 再试。");
      }
      return;
    }
  }

  // Auto-fetch and summarize URLs
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = userMessage.match(urlRegex);
  const isJustUrl = urls && urls.length === 1 && userMessage.trim() === urls[0];
  const hasUrlWithNoContext = urls && urls.length >= 1 && userMessage.trim().length < 120;

  if (urls && (isJustUrl || hasUrlWithNoContext)) {
    await ctx.sendChatAction("typing");
    try {
      let url = urls[0];
      // Auto-convert GitHub blob URLs to raw
      if (url.includes("github.com") && url.includes("/blob/")) {
        url = url
          .replace("github.com", "raw.githubusercontent.com")
          .replace("/blob/", "/");
        console.log("Converted to raw GitHub URL:", url);
      }
      const fetchRes = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ClaudeBot/1.0)" },
        signal: AbortSignal.timeout(8000)
      });
      const html = await fetchRes.text();
      // Strip HTML tags
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 6000);

      if (text.length > 200) {
        const instruction = isJustUrl
          ? "总结这个网页的主要内容，提取关键信息。"
          : userMessage.replace(url, "").trim() || "总结这个网页的主要内容。";
        const result = await withLock(userId, async function() {
          return await askClaude(userId, "网页链接: " + url + "\n\n网页内容:\n" + text + "\n\n" + instruction, ctx);
        });
        if (result) await sendLongMessage(ctx, result);
        return;
      }
    } catch (err) {
      console.error("URL fetch error:", err.message);
      // Fall through to normal processing if fetch fails
    }
  }

  // Auto-summarize if message too long
  let processedMessage = userMessage;
  if (userMessage.length > 3000) {
    try {
      await ctx.sendChatAction("typing");
      const summaryRes = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        messages: [{
          role: "user",
          content: "请把以下内容压缩成简洁的摘要，保留所有关键信息、代码、链接和数字，不要丢失重要细节：\n\n" + userMessage
        }]
      });
      const summary = (summaryRes.content[0] || {}).text || userMessage;
      processedMessage = "[自动压缩摘要]\n" + summary;
      console.log("Auto-summarized message from", userMessage.length, "to", processedMessage.length, "chars");
    } catch (err) {
      console.error("Auto-summarize failed:", err.message);
      processedMessage = userMessage.substring(0, 3000) + "...[内容过长已截断]";
    }
  }

  await ctx.sendChatAction("typing");
  try {
    const result = await withLock(userId, async function() {
      return await askClaude(userId, processedMessage, ctx);
    });
    if (result) {
      await sendLongMessage(ctx, result);
    }
    // if null, silently drop duplicate request
  } catch (err) {
    console.error("Claude error:", err.message);
    await ctx.reply("出错了，请稍后再试。");
  }
});

// ── 处理图片 ──────────────────────────────────────────────────────────────────
bot.on("photo", async function(ctx) {
  const userId = ctx.from.id;
  await ctx.sendChatAction("typing");
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const file = await ctx.telegram.getFile(photo.file_id);
    const fileUrl = "https://api.telegram.org/file/bot" + BOT_TOKEN + "/" + file.file_path;
    const imageResponse = await fetch(fileUrl);
    const arrayBuffer = await imageResponse.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const caption = ctx.message.caption || "请详细描述这张图片的内容。";
    const systemPrompt = await buildSystemPrompt(userId, caption);
    const history = await getHistory(userId);
    const msgs = history.length > 0 ? [...history] : [];
    msgs.push({
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
        { type: "text", text: caption }
      ]
    });
    const response = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 4096,
      system: systemPrompt,
      messages: msgs
    });
    const reply = response.content[0] ? response.content[0].text : "I could not analyze this image.";
    await saveMessage(userId, "user", "[图片] " + caption);
    await saveMessage(userId, "assistant", reply);
    autoLearnMemory(userId, "[图片] " + caption, reply).catch(function(err) { console.error(err.message); });
    await sendLongMessage(ctx, reply);
  } catch (err) {
    console.error("Image error:", err.message);
    await ctx.reply("图片处理失败，请重新发送。");
  }
});

bot.on("document", async function(ctx) {
  const doc = ctx.message && ctx.message.document;
  if (!doc) return;
  const mime = doc.mime_type || "";

  if (mime === "application/pdf") {
    const userId = ctx.from.id;
    await ctx.sendChatAction("upload_document");
    try {
      const fileLink = await ctx.telegram.getFileLink(doc.file_id);
      const response = await fetch(fileLink.href);
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      await ctx.sendChatAction("typing");
      const caption = ctx.message.caption || "请分析这份 PDF 文档，给我摘要和关键要点。";
      const result = await withLock(userId, async function() {
        const systemPrompt = await buildSystemPrompt(userId, caption);
        const pdfResponse = await anthropic.messages.create({
          model: "claude-opus-4-5",
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: "user", content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
            { type: "text", text: caption }
          ]}]
        });
        return (pdfResponse.content[0] || {}).text || "无法分析此 PDF。";
      });
      if (result) {
        await saveMessage(userId, "user", "[PDF: " + (doc.file_name || "document.pdf") + "] " + caption);
        await saveMessage(userId, "assistant", result);
        await sendLongMessage(ctx, result);
      }
    } catch (err) {
      console.error("PDF error:", err.message);
      await ctx.reply("PDF 处理失败: " + err.message);
    }
  } else {
    // Handle text-based files: log, txt, csv, json, js, py, etc
    const textMimes = ["text/", "application/json", "application/javascript", "application/x-python"];
    const textExts = [".log", ".txt", ".csv", ".json", ".js", ".py", ".ts", ".sh", ".md", ".yaml", ".yml", ".env", ".cjs", ".mjs"];
    const fileName = doc.file_name || "";
    const isTextFile = textMimes.some(function(m) { return mime.startsWith(m); }) ||
                       textExts.some(function(e) { return fileName.toLowerCase().endsWith(e); });

    if (isTextFile) {
      const userId = ctx.from.id;
      await ctx.sendChatAction("typing");
      try {
        const fileLink = await ctx.telegram.getFileLink(doc.file_id);
        const response = await fetch(fileLink.href);
        const text = await response.text();
        const caption = ctx.message.caption || "分析这个文件，找出关键信息、错误或问题。";

        // Truncate if too long
        const maxChars = 8000;
        const fileContent = text.length > maxChars
          ? text.substring(0, maxChars) + "\n...[文件过长，已截断前 " + maxChars + " 字符]"
          : text;

        const result = await withLock(userId, async function() {
          const systemPrompt = await buildSystemPrompt(userId, caption);
          const res = await anthropic.messages.create({
            model: "claude-opus-4-5",
            max_tokens: 4096,
            system: systemPrompt,
            messages: [{ role: "user", content: "文件名: " + fileName + "\n\n文件内容:\n" + fileContent + "\n\n" + caption }]
          });
          return (res.content[0] || {}).text || "无法分析此文件。";
        });

        if (result) {
          await saveMessage(userId, "user", "[文件: " + fileName + "] " + caption);
          await saveMessage(userId, "assistant", result);
          await sendLongMessage(ctx, result);
        }
      } catch (err) {
        console.error("File error:", err.message);
        await ctx.reply("文件处理失败: " + err.message);
      }
    } else {
      await ctx.reply("暂不支持此文件格式。支持：PDF、log、txt、csv、json、js、py 等文字文件。");
    }
  }
});

// ── 启动 ──────────────────────────────────────────────────────────────────────
async function launch() {
  if (WEBHOOK_URL) {
    const app = express();
    app.use(express.json());
    app.use(bot.webhookCallback("/webhook"));
    app.get("/", function(_req, res) { res.send("Claude AI Bot v5 - Running!"); });
    await bot.telegram.setWebhook(WEBHOOK_URL + "/webhook");
    app.listen(PORT, function() {
      console.log("Webhook running on port " + PORT);
      console.log("Webhook set to " + WEBHOOK_URL + "/webhook");
    });
  } else {
    await bot.launch();
    console.log("Bot running in polling mode");
  }
}

launch().catch(console.error);

// PDF 文件处理
bot.on(["message"], async function(ctx) {
  const doc = ctx.message && ctx.message.document;
  if (!doc) return;
  const mime = doc.mime_type || "";
  if (mime !== "application/pdf") return;

  const userId = ctx.from.id;
  await ctx.sendChatAction("upload_document");

  try {
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    const response = await fetch(fileLink.href);
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    await ctx.sendChatAction("typing");
    const caption = ctx.message.caption || "请分析这份 PDF 文档，给我摘要和关键要点。";

    const result = await withLock(userId, async function() {
      const docs = await Promise.all([
        getDoc(userId, "soul"),
        getDoc(userId, "projects"),
        getDoc(userId, "tasks"),
        getDoc(userId, "notes")
      ]);
      const [soul, projects, tasks, notes] = docs;
      let systemPrompt = SYSTEM_PROMPT;
      if (soul) systemPrompt += "\n\n[USER PROFILE]\n" + soul;
      if (projects) systemPrompt += "\n\n[PROJECTS]\n" + projects;
      if (tasks) systemPrompt += "\n\n[TASKS]\n" + tasks;
      if (notes) systemPrompt += "\n\n[NOTES]\n" + notes;

      const pdfResponse = await anthropic.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: base64 }
            },
            { type: "text", text: caption }
          ]
        }]
      });
      return (pdfResponse.content[0] || {}).text || "无法分析此 PDF。";
    });

    if (result) {
      await saveMessage(userId, "user", "[PDF: " + (doc.file_name || "document.pdf") + "] " + caption);
      await saveMessage(userId, "assistant", result);
      await sendLongMessage(ctx, result);
    }
  } catch (err) {
    console.error("PDF error:", err.message);
    await ctx.reply("PDF 处理失败: " + err.message);
  }
});

process.once("SIGINT", function() { bot.stop("SIGINT"); });
process.once("SIGTERM", function() { bot.stop("SIGTERM"); });

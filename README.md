# 🤖 Claude AI Bot

**EN:** A personal AI assistant powered by Claude, running on Telegram. Smart memory, code tools, image generation, and more — all from your phone.

**中文:** 基于 Claude 的 Telegram 私人 AI 助理。智能记忆、代码工具、图片生成 —— 全部手机操作。

-----

## 🚀 One-Click Deploy / 一键部署

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/deploy/hi0iqD?referralCode=ztkI8u&utm_medium=integration&utm_source=template&utm_campaign=generic)

**EN:** Click the button → fill in env variables → done in 5 minutes.

**中文:** 点按钮 → 填环境变量 → 5 分钟完成。

-----

## ✨ Features / 主要功能

- 💬 **Smart Chat** — Powered by Claude with persistent memory across conversations
- 🧠 **4-Layer Memory** — Soul / Projects / Tasks / Notes auto-update from your conversations
- 💻 **Code Tools** — Explain, review, test, and version your code
- 🎨 **Image Generation** — Create images with Gemini
- 📝 **Writing Tools** — Translate, improve, brainstorm
- 📎 **File Support** — PDF, ZIP, DOCX, XLSX, images, code files all auto-parsed
- 🔗 **URL Auto-Summary** — Send any link, get a summary
- ⏰ **Reminders & Templates** — Save prompts, set timed reminders
- 📊 **Usage Tracking** — See your token usage and costs

-----

## 📦 Manual Deploy / 手动部署

### Step 1 — Create Telegram Bot / 创建 Telegram Bot

- Open [@BotFather](https://t.me/BotFather) → send `/newbot` → follow prompts → copy your **BOT_TOKEN**
- 打开 [@BotFather](https://t.me/BotFather) → 发送 `/newbot` → 按提示走 → 复制 **BOT_TOKEN**

### Step 2 — Get API Keys / 获取 API Keys

|Service / 服务      |Where / 获取地址                                                       |Required / 必须   |
|------------------|-------------------------------------------------------------------|----------------|
|Anthropic         |[console.anthropic.com](https://console.anthropic.com) → API Keys  |✅               |
|Supabase          |[supabase.com](https://supabase.com) → New Project → Settings → API|✅               |
|Telegram BOT_TOKEN|@BotFather                                                         |✅               |
|Voyage AI         |[voyageai.com](https://voyageai.com)                               |推荐 / Recommended|
|Gemini API Key    |[aistudio.google.com](https://aistudio.google.com)                 |`/imagine`      |

### Step 3 — Supabase Setup / 设置 Supabase

**EN:** Create a new project → open **SQL Editor** → run the SQL below.

**中文:** 新建项目 → 打开 **SQL Editor** → 运行下方 SQL。

```sql
create extension if not exists vector;

create table if not exists conversations (
  id bigserial primary key,
  user_id bigint not null,
  role text not null,
  content text not null,
  created_at timestamptz default now()
);

create table if not exists user_docs (
  user_id bigint not null,
  doc_type text not null,
  content text,
  updated_at timestamptz default now(),
  primary key (user_id, doc_type)
);

create table if not exists conversation_summaries (
  user_id bigint primary key,
  summary text,
  updated_at timestamptz default now()
);

create table if not exists memories (
  id bigserial primary key,
  user_id bigint not null,
  content text not null,
  memory_type text default 'general',
  embedding vector(1024),
  created_at timestamptz default now()
);

create or replace function search_memories(
  query_embedding vector(1024),
  match_user_id bigint,
  match_count int default 5
) returns table (content text, similarity float)
language sql stable as $$
  select content, 1 - (embedding <=> query_embedding) as similarity
  from memories
  where user_id = match_user_id and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;

alter table conversations disable row level security;
alter table user_docs disable row level security;
alter table conversation_summaries disable row level security;
alter table memories disable row level security;
```

### Step 4 — Deploy to Railway / 部署到 Railway

**EN:** Fork this repo → [railway.app](https://railway.app) → New Project → Deploy from GitHub → select your fork → add environment variables.

**中文:** Fork 本仓库 → [railway.app](https://railway.app) → New Project → Deploy from GitHub → 选你的 Fork → 添加环境变量。

### Step 5 — Set Webhook / 设置 Webhook

**EN:** After deployment, copy your Railway public URL and add it as `WEBHOOK_URL`. Redeploy.

**中文:** 部署完后，复制 Railway 域名加入环境变量 `WEBHOOK_URL`，重新部署。

```env
WEBHOOK_URL=https://your-app.up.railway.app
```

### Step 6 — Test / 测试

**EN:** Send `/help` to your bot. If you see the command list, you’re live ✅

**中文:** 发 `/help` 给 bot，看到命令列表就成功了 ✅

-----

## ⚙️ Environment Variables / 环境变量

```env
# ✅ Required / 必须
BOT_TOKEN=                     # @BotFather 给的 token
ANTHROPIC_API_KEY=             # console.anthropic.com
WEBHOOK_URL=                   # Railway 域名（不带末尾斜杠）
SUPABASE_URL=                  # Supabase project URL
SUPABASE_KEY=                  # service_role key（不是 anon key）

# 💡 Recommended / 推荐
VOYAGE_API_KEY=                # 向量记忆搜索
GEMINI_API_KEY=                # /imagine 图片生成
```

-----

## 📋 Commands / 命令

### 💬 Conversation / 对话

|Command                   |What it does / 功能           |
|--------------------------|----------------------------|
|`/translate <lang> <text>`|Translation / 翻译            |
|`/improve <text>`         |Polish writing / 润色         |
|`/brainstorm <topic>`     |Brainstorm analysis / 头脑风暴  |
|`/summarize`              |Compress chat history / 压缩对话|

### 💻 Code Tools / 代码工具

Just send any code file and it auto-analyzes.

|Command    |What it does               |
|-----------|---------------------------|
|`/explain` |Explain code / 解释代码        |
|`/review`  |Code review with score / 评分|
|`/test`    |Generate tests / 生成测试      |
|`/save <n>`|Save version / 保存版本        |
|`/load <n>`|Load saved version / 加载    |
|`/versions`|List versions / 列出版本       |

### 🎨 Creative / 创作

|Command                 |What it does               |
|------------------------|---------------------------|
|`/imagine <description>`|AI image generation / AI 出图|

### 🧠 Memory / 记忆 (4 layers)

|Command                   |What it does               |
|--------------------------|---------------------------|
|`/memory`                 |Full memory overview / 完整记忆|
|`/soul` `/setsoul`        |Personal profile / 个人档案    |
|`/projects` `/setprojects`|Project profile / 项目档案     |
|`/tasks` `/settasks`      |Task profile / 任务档案        |
|`/notes` `/note <text>`   |Quick notes / 快速笔记         |
|`/clearnotes`             |Clear notes / 清空笔记         |

### ⚙️ Utilities / 实用工具

|Command                  |What it does                     |
|-------------------------|---------------------------------|
|`/remind <time> <text>`  |Set reminder (30m / 2h / 1d) / 提醒|
|`/template save/use/list`|Manage prompt templates / 模板     |
|`/stats`                 |Token usage & cost / 用量统计        |
|`/export`                |Export chat history / 导出聊天       |
|`/forget`                |Clear conversation history / 清对话 |
|`/reset`                 |Reset everything / 全部重置          |
|`/help`                  |Full command list / 命令列表         |

### 📎 Auto-Handled / 自动支持

- Send a **PDF, ZIP, DOCX, XLSX, image, or code file** → auto-parsed and analyzed
- Send a **URL** → auto-fetched and summarized

-----

## 🛠 Tech Stack / 技术栈

|Layer        |Tech               |
|-------------|-------------------|
|Bot Framework|Telegraf (Node.js) |
|AI           |Claude (Anthropic) |
|Image Gen    |Gemini             |
|Database     |Supabase + pgvector|
|Vector Memory|Voyage AI          |
|Deployment   |Railway            |

-----

## 🐛 Troubleshooting / 故障排除

### Bot doesn’t respond / 不回复

- Check `BOT_TOKEN` and `ANTHROPIC_API_KEY` are correct
- Verify `WEBHOOK_URL` matches your Railway domain (no trailing slash)
- Check Railway logs

### Memory not working / 记忆失效

- Without `VOYAGE_API_KEY`, vector search is disabled (other memory still works)
- Verify Supabase `vector` extension is enabled

### Cost too high / 费用过高

- Check `/stats` to see usage
- Use `/forget` periodically to clear long histories
- Keep `/soul` and `/projects` concise

-----

## 📜 License

MIT
